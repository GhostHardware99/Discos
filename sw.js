/* Service worker — cambia VERSION cada vez que subas un index.html nuevo */
var VERSION = 'v79-2026-10-16';
var CACHE = 'app-' + VERSION;
/* Portadas: caché propia que NO se borra al actualizar la app */
var IMG = 'covers-v1', IMGMAX = 5000, BAD = {};
/* Portadas «opacas» (sitios sin CORS cuando no hay proxy): se guardan aparte con tope bajo, porque el navegador cuenta cada una como ~7 MB de cuota */
var OPQ = 'covers-opq-v1', OPQMAX = 200;
var CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

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
        return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== IMG && k !== OPQ; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* Portadas de cualquier sitio: primero la caché; si no está, se descarga y se guarda para siempre (hasta IMGMAX). */
var WES = 'https://images.weserv.nl/?w=800&we&q=86&output=jpg&url=';
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
    // Red primero: siempre carga la versión nueva si hay conexión
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match('index.html') || caches.match('./');
        });
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
