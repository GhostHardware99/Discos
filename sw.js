/* Service worker — cambia VERSION cada vez que subas un index.html nuevo */
var VERSION = 'v60-2026-10-15';
var CACHE = 'app-' + VERSION;
/* Portadas: caché propia que NO se borra al actualizar la app */
var IMG = 'covers-v1', IMGMAX = 800, BAD = {};
var CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(CORE).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== IMG; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* Portadas de cualquier sitio: primero la caché; si no está, se descarga y se guarda para siempre (hasta IMGMAX). */
function imgNet(u, cors) {
  var ctl = ('AbortController' in self) ? new AbortController() : null;
  var to = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
  return fetch(u, { mode: 'cors', credentials: 'omit', signal: ctl && ctl.signal })
    .then(function (r) { clearTimeout(to); return r; }, function (e) {
      clearTimeout(to);
      if (cors) throw e;
      /* sitio sin CORS: se muestra igual, pero no se guarda (no se sabe si es una imagen válida) */
      var c2 = ('AbortController' in self) ? new AbortController() : null;
      var t2 = setTimeout(function () { if (c2) c2.abort(); }, 10000);
      return fetch(u, { mode: 'no-cors', credentials: 'omit', signal: c2 && c2.signal })
        .then(function (r) { clearTimeout(t2); return r; }, function (e2) { clearTimeout(t2); throw e2; });
    });
}
function imgFetch(req) {
  var u = req.url, host = new URL(u).host, cors = req.mode === 'cors';
  return caches.open(IMG).then(function (c) {
    return c.match(u).then(function (hit) {
      if (hit) return hit;
      var b = BAD[host];
      /* sitio que falló 3 veces seguidas en los últimos 5 min: falla al instante y la app pasa a su alternativa */
      if (b && b.n >= 3 && Date.now() - b.t < 300000) return Response.error();
      return imgNet(u, cors).then(function (r) {
        if (r.type === 'opaque') { BAD[host] = { n: 0, t: Date.now() }; return r; }
        if (r.ok) {
          BAD[host] = { n: 0, t: Date.now() };
          c.put(u, r.clone()).then(function () {
            return c.keys().then(function (ks) { if (ks.length > IMGMAX) return c.delete(ks[0]); });
          }).catch(function () {});
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
