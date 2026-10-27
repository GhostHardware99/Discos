/* Service worker — cambia VERSION cada vez que subas un index.html nuevo */
var VERSION = 'v224-2026-10-27';
var CACHE = 'app-' + VERSION;
/* Portadas: caché propia que NO se borra al actualizar la app */
var IMG = 'covers-v1', IMGMAX = 5000, BAD = {};
/* Portadas «opacas» (sitios sin CORS cuando no hay proxy): se guardan aparte con tope bajo, porque el navegador cuenta cada una como ~7 MB de cuota */
var OPQ = 'covers-opq-v1', OPQMAX = 200;
var CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'badge-96.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); })); })
      .then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== IMG && k !== OPQ && k !== 'digz-cfg'; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* Portadas de cualquier sitio: primero la caché; si no está, se descarga y se guarda para siempre (hasta IMGMAX). */
var WES = 'https://images.weserv.nl/?w=1200&we&q=88&output=jpg&url=';
function tryFetch(u, mode, ms) {
  var ctl = ('AbortController' in self) ? new AbortController() : null;
  var to = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
  return fetch(u, { mode: mode, credentials: 'omit', signal: ctl && ctl.signal })
    .then(function (r) { clearTimeout(to); return r; }, function (e) { clearTimeout(to); throw e; });
}
/* 1) directo con CORS (se puede guardar)  2) si el sitio no permite CORS o está bloqueado: a través de weserv, que sí permite
   guardar (la imagen queda en caché con su URL original)  3) último recurso: directo sin CORS (se muestra, pero no se guarda) */
var INF = {}, INFN = 0, NOCORS = {};
function imgNet(u, cors, c, oc) {
  var host = new URL(u).host;
  return (!cors && NOCORS[host] ? Promise.reject(new Error('nocors')) : tryFetch(u, 'cors', 5000)).catch(function (e) {
    if (/(^|\.)weserv\.nl$/.test(host)) throw e;
    if (cors) {
      return tryFetch(WES + encodeURIComponent(u), 'cors', 15000).then(function (r) {
        if (!r.ok) throw new Error('wes');
        return r;
      });
    }
    /* <img> normal: se muestra YA la imagen directa (sin CORS) y en segundo plano se guarda una copia vía weserv para la próxima vez */
    NOCORS[host] = 1;
    if (!INF[u] && INFN < 2) {
      INFN++;
      INF[u] = tryFetch(WES + encodeURIComponent(u), 'cors', 20000).then(function (r) {
        if (!r.ok) throw new Error('wes');
        return c.put(u, r.clone()).then(function () { return trimImgs(c); });
      }).catch(function () {
        return tryFetch(u, 'no-cors', 10000).then(function (r) { return oc.put(u, r).then(function () { return trimOpq(oc); }); }).catch(function () {});
      }).then(function () { delete INF[u]; INFN--; });
    }
    return tryFetch(u, 'no-cors', 10000);
  });
}
var PUTS = 0;
/* Tope por cantidad (IMGMAX) y por espacio: si el teléfono se queda sin sitio (>75 % de la cuota), borra las más antiguas */
function trimImgs(c) {
  PUTS++;
  return c.keys().then(function (ks) {
    var over = ks.length - IMGMAX;
    if (over > 0) return Promise.all(ks.slice(0, over).map(function (k) { return c.delete(k); }));
    if (PUTS % 25 === 0 && self.navigator && navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        if (e && e.quota && e.usage / e.quota > 0.75) return Promise.all(ks.slice(0, 150).map(function (k) { return c.delete(k); }));
      });
    }
  });
}
function trimOpq(c) {
  return c.keys().then(function (ks) {
    var over = ks.length - OPQMAX;
    if (over > 0) return Promise.all(ks.slice(0, over).map(function (k) { return c.delete(k); }));
  });
}
function imgFetch(req) {
  var u = req.url, host = new URL(u).host, cors = req.mode === 'cors';
  return Promise.all([caches.open(IMG), caches.open(OPQ)]).then(function (cs) {
    var c = cs[0], oc = cs[1];
    return c.match(u).then(function (hit) { return hit || (cors ? null : oc.match(u)); }).then(function (hit) {
      if (hit) return hit;
      var b = BAD[host];
      /* sitio que falló 3 veces seguidas en los últimos 5 min: falla al instante y la app pasa a su alternativa */
      if (b && b.n >= 3 && Date.now() - b.t < 15000) return Response.error();
      return imgNet(u, cors, c, oc).then(function (r) {
        if (r.type === 'opaque') {
          BAD[host] = { n: 0, t: Date.now() };
          return r;
        }
        if (r.ok) {
          BAD[host] = { n: 0, t: Date.now() };
          c.put(u, r.clone()).then(function () { return trimImgs(c); }).catch(function () {});
          return r;
        }
        return r;
      }, function () {
        var o = BAD[host] || { n: 0, t: 0 };
        BAD[host] = { n: o.n + 1, t: Date.now() };
        return Response.error();
      });
    });
  }).catch(function () { return fetch(req); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.destination === 'image' && url.origin !== self.location.origin && /^https?:$/.test(url.protocol)) {
    e.respondWith(imgFetch(req));
    return;
  }
  // Solo gestiona tu propio dominio; APIs y portadas externas pasan directas
  if (url.origin !== self.location.origin) return;

  var isPage = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') > -1;
  if (isPage) {
    /* Caché primero: la app abre al instante (sin esperar a la red ni mostrar barra de carga).
       En segundo plano se descarga la versión nueva; si cambió, se avisa a la app y se usa al reabrir. */
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        hit = hit || null;
        var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            var changed = hit && res.headers.get('etag') !== hit.headers.get('etag');
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
            if (changed) {
              self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ t: 'NEW' }); }); });
            }
          }
          return res;
        });
        if (hit) {
          e.waitUntil(net.catch(function () {}));
          return hit;
        }
        return net.catch(function () { return caches.match('index.html') || caches.match('./'); });
      })
    );
    return;
  }
  // Resto de archivos propios: caché y actualiza en segundo plano
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

/* ---------- Avisos push de álbumes programados ----------
   El servidor manda un push SIN contenido; aquí se pide al servidor qué álbumes tocan hoy y se muestra el aviso. */
function pushSha(t) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) {
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 32);
  });
}
var PUSH_DEF = 'https://digz-push.blancocory35.workers.dev';
var BADGE = 'data:image/png;base64,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';
function pushToday() { var n = new Date(); return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2); }
function pushNow() { var n = new Date(); return ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2); }
async function pushShow(items) {
  var title, body, opt = { badge: BADGE, tag: 'digz-plan-' + (items[0] ? items[0].d + '-' + (items[0].t || '') : 'x'), renotify: true, data: { d: items[0] && items[0].d } };
  title = 'Digz';
  if (!items.length) body = 'Tienes un álbum programado\nProgramado para hoy';
  else if (items.length == 1) { body = (items[0].ar ? items[0].ar + ' · ' : '') + items[0].al + '\nProgramado para hoy'; }
  else body = items.length + ' álbumes programados para hoy\n' + items.slice(0, 3).map(function (i) { return i.al; }).join(' · ') + (items.length > 3 ? '…' : '');
  opt.icon = (items.length == 1 && items[0].c) ? items[0].c : 'icon-192.png';
  if (items.length > 1) {
    try { var cs = await caches.open('digz-cfg'), rs = await cs.match('stacks'); if (rs) { var sm = await rs.json(), sk = items[0].d + '|' + items[0].t; if (sm[sk]) opt.icon = sm[sk]; } } catch (x) {}
  }
  opt.body = body;
  await self.registration.showNotification(title, opt);
}
function pushKey(i) { return i.al + '|' + i.d + '|' + (i.t || ''); }
async function pushDue(c) {
  var today = pushToday(), hm = pushNow(), out = [];
  try {
    var rp = await c.match('plans'), rs = await c.match('shown'), shown = rs ? await rs.json() : {};
    if (rp) out = ((await rp.json()) || []).filter(function (i) { return i.d && (i.d < today || (i.d == today && (i.t || '09:00') <= hm)) && !shown[pushKey(i)]; });
  } catch (x) {}
  return out;
}
async function pushMark(c, items) {
  try {
    var rs = await c.match('shown'), shown = rs ? await rs.json() : {}, today = pushToday(), n = {};
    Object.keys(shown).forEach(function (k) { if (k.split('|')[1] >= today) n[k] = 1; });
    items.forEach(function (i) { n[pushKey(i)] = 1; });
    await c.put('shown', new Response(JSON.stringify(n)));
  } catch (x) {}
}
/* Comprobación local de programados (la dispara la app abierta o la sincronización periódica) */
async function planCheck() {
  var c = await caches.open('digz-cfg'), due = await pushDue(c);
  var today = pushToday(); due = due.filter(function (i) { return i.d == today; });
  if (!due.length) return;
  await pushMark(c, due); await pushShow(due);
}
self.addEventListener('message', function (e) { if (e.data && e.data.type == 'plan-check') e.waitUntil(planCheck()); });
self.addEventListener('periodicsync', function (e) { if (e.tag == 'digz-plan') e.waitUntil(planCheck()); });
self.addEventListener('push', function (e) {
  e.waitUntil((async function () {
    var items = [], c = null;
    try { c = await caches.open('digz-cfg'); items = await pushDue(c); } catch (x) {}
    if (!items.length) {
      try {
        var r = c && await c.match('push-url'), url = (r ? await r.text() : '') || PUSH_DEF;
        var sub = await self.registration.pushManager.getSubscription();
        if (url && sub) {
          var id = await pushSha(sub.endpoint), j = await (await fetch(url + '/last?id=' + id)).json();
          items = (j && j.items) || [];
        }
      } catch (x) {}
    } else await pushMark(c, items);
    await pushShow(items);
  })());
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    for (var i = 0; i < cl.length; i++) { if ('focus' in cl[i]) return cl[i].focus(); }
    return self.clients.openWindow('./');
  }));
});
