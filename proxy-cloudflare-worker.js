// Proxy CORS propio para Digz (Cloudflare Workers, plan gratis).
// Uso en la app: Ajustes > Conexión y fuentes > Proxy propio = https://TU-WORKER.workers.dev/
// >>> ESCRIBE TU CORREO ENTRE LAS COMILLAS (MusicBrainz lo pide). Es lo único que debes cambiar. <<<
const CONTACT_EMAIL = 'econoniso2008@gmail.com';
const OK = ['api.deezer.com','itunes.apple.com','musicbrainz.org','www.theaudiodb.com','api.discogs.com',
  'ws.audioscrobbler.com','coverartarchive.org','en.wikipedia.org','es.wikipedia.org'];
// Orígenes permitidos: GitHub Pages (PWA/TWA) y la apk empaquetada con Capacitor/WebView
const ORIGINS = ['https://ghosthardware99.github.io','https://localhost','http://localhost','capacitor://localhost'];
// Resuelve la página exacta de un álbum en un sitio (para los chips de Críticas de la app).
// Uso: GET /?resolve=rateyourmusic.com/release&q=Artista+Álbum  ->  {"url":"https://..."}  (url vacía si no se encuentra)
const BUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const GO_OK = ['metacritic.com','albumoftheyear.org','rateyourmusic.com','pitchfork.com','allmusic.com','rollingstone.com','nme.com','sputnikmusic.com','stereogum.com','consequence.net','youtube.com','discogs.com','genius.com','en.wikipedia.org'];
function fallbackUrl(host, q) {
  const Q = encodeURIComponent(q);
  const m = {'metacritic.com': 'https://www.metacritic.com/search/' + Q + '/', 'albumoftheyear.org': 'https://www.albumoftheyear.org/search/?q=' + Q,
    'rateyourmusic.com': 'https://rateyourmusic.com/search?searchterm=' + Q + '&searchtype=l', 'pitchfork.com': 'https://pitchfork.com/search/?query=' + Q,
    'allmusic.com': 'https://www.allmusic.com/search/albums/' + Q, 'sputnikmusic.com': 'https://www.sputnikmusic.com/search_results.php?search_in=Album&search_text=' + Q,
    'youtube.com': 'https://www.youtube.com/results?search_query=' + Q, 'discogs.com': 'https://www.discogs.com/search/?type=master&q=' + Q,
    'genius.com': 'https://genius.com/search?q=' + Q, 'en.wikipedia.org': 'https://en.wikipedia.org/w/index.php?search=' + Q};
  return m[host] || 'https://www.google.com/search?q=' + encodeURIComponent('site:' + host + ' ' + q);
}
async function resolveLink(site, q) {
  const host = site.split('/')[0], path = site.slice(host.length) || '/';
  const okUrl = (u) => { try { const x = new URL(u); return (x.hostname === host || x.hostname.endsWith('.' + host)) && x.pathname.indexOf(path) === 0 && x.pathname.length > path.length + 1; } catch (e) { return false; } };
  const query = 'site:' + site + ' ' + q;
  const H = {'User-Agent': BUA, 'Accept-Language': 'en-US,en;q=0.8', 'Accept': 'text/html'};
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {headers: H});
    const t = await r.text(), re = /class="result__a"[^>]*href="([^"]+)"/g; let m;
    while ((m = re.exec(t))) {
      let h = m[1].replace(/&amp;/g, '&'); const mm = /[?&]uddg=([^&]+)/.exec(h);
      if (mm) h = decodeURIComponent(mm[1]); else if (h.indexOf('//') === 0) h = 'https:' + h;
      if (okUrl(h)) return h;
    }
  } catch (e) {}
  try {
    const r = await fetch('https://www.bing.com/search?setlang=en&q=' + encodeURIComponent(query), {headers: H});
    const t = await r.text(), re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"/g; let m;
    while ((m = re.exec(t))) {
      let h = m[1].replace(/&amp;/g, '&');
      if (h.indexOf('bing.com/ck/a') > -1) { try { const u = new URL(h).searchParams.get('u'); if (u && u.indexOf('a1') === 0) h = atob(u.slice(2).replace(/-/g, '+').replace(/_/g, '/')); } catch (e) {} }
      if (okUrl(h)) return h;
    }
  } catch (e) {}
  return '';
}
export default {
  async fetch(req, env) {
    const o = req.headers.get('Origin');
    const ORIGIN = ORIGINS.includes(o) ? o : ORIGINS[0];
    const UA = (new URL(req.url).searchParams.get('url') || '').indexOf('https://itunes.apple.com') === 0
      ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' // Apple rechaza a veces User-Agents desconocidos
      : 'Digz/1.0 (' + CONTACT_EMAIL + ')';
    const cors = {'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'X-Upstream-Status'};
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
    const sp = new URL(req.url).searchParams;
    // Enlace normal de los chips de Críticas: redirige a la página exacta del álbum (o a la búsqueda del sitio)
    if (sp.get('go')) {
      const site = sp.get('go'), host = site.split('/')[0], q = sp.get('q') || '';
      if (GO_OK.indexOf(host) < 0) return new Response('site not allowed', {status: 400, headers: cors});
      const found = await resolveLink(site, q);
      return new Response(null, {status: 302, headers: {'Location': found || fallbackUrl(host, q), 'Cache-Control': found ? 'public, max-age=2592000' : 'no-store'}});
    }
    if (sp.get('resolve')) {
      const found = await resolveLink(sp.get('resolve'), sp.get('q') || '');
      return new Response(JSON.stringify({url: found}), {headers: Object.assign({'Content-Type': 'application/json', 'Cache-Control': found ? 'public, max-age=2592000' : 'no-store'}, cors)});
    }
    const t = new URL(req.url).searchParams.get('url');
    let u; try { u = new URL(t); } catch (e) { return new Response('bad url', {status: 400, headers: cors}); }
    if (u.protocol !== 'https:' || !OK.includes(u.hostname)) return new Response('host not allowed', {status: 403, headers: cors});
    // Discogs: el token vive aquí como secreto (DISCOGS_TOKEN), nunca en la apk. Respuestas en caché 30 días.
    let ttl = 300;
    if (u.hostname === 'api.discogs.com') {
      if (!u.searchParams.get('token')) {
        if (!env || !env.DISCOGS_TOKEN) return new Response('no discogs token', {status: 401, headers: cors});
        u.searchParams.set('token', env.DISCOGS_TOKEN);
      }
      ttl = 2592000;
    }
    const opts = {
      headers: {'User-Agent': UA, 'Accept': req.headers.get('Accept') || '*/*'},
      redirect: 'manual',
      cf: {cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: {'200-299': ttl, '300-399': 0, '400-599': 0}}
    };
    const isIT = u.hostname === 'itunes.apple.com';
    // iTunes limita por IP y las IPs de Cloudflare se comparten: ante 403/429/5xx se reintenta una vez
    const go = async (url) => {
      let x = await fetch(url, opts);
      if (isIT && (x.status === 403 || x.status === 429 || x.status >= 500)) {
        await new Promise(k => setTimeout(k, 700));
        x = await fetch(url, opts);
      }
      return x;
    };
    let r;
    try { r = await go(u.toString()); }
    catch (e) { return new Response('upstream error', {status: 502, headers: cors}); }
    // Sigue una redirección solo si va a otro dominio permitido
    if (r.status >= 300 && r.status < 400 && r.headers.get('Location')) {
      let n; try { n = new URL(r.headers.get('Location'), u); } catch (e) { return new Response('bad redirect', {status: 502, headers: cors}); }
      if (n.protocol !== 'https:' || !OK.includes(n.hostname)) return new Response('redirect not allowed', {status: 403, headers: cors});
      try { r = await go(n.toString()); } catch (e) { return new Response('upstream error', {status: 502, headers: cors}); }
    }
    const h = new Headers(r.headers);
    for (const k in cors) h.set(k, cors[k]);
    h.set('X-Upstream-Status', String(r.status));
    return new Response(r.body, {status: r.status, headers: h});
  }
};
