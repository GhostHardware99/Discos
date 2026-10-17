// Proxy CORS propio para Digz (Cloudflare Workers, plan gratis).
// Uso en la app: Ajustes > Conexión y fuentes > Proxy propio = https://TU-WORKER.workers.dev/
// >>> ESCRIBE TU CORREO ENTRE LAS COMILLAS (MusicBrainz lo pide). Es lo único que debes cambiar. <<<
const CONTACT_EMAIL = 'econoniso2008@gmail.com';
const OK = ['api.deezer.com','itunes.apple.com','musicbrainz.org','www.theaudiodb.com','api.discogs.com',
  'ws.audioscrobbler.com','coverartarchive.org','en.wikipedia.org','es.wikipedia.org'];
// Orígenes permitidos: GitHub Pages (PWA/TWA) y la apk empaquetada con Capacitor/WebView
const ORIGINS = ['https://ghosthardware99.github.io','https://localhost','http://localhost','capacitor://localhost'];
export default {
  async fetch(req, env) {
    const o = req.headers.get('Origin');
    const ORIGIN = ORIGINS.includes(o) ? o : ORIGINS[0];
    const UA = (new URL(req.url).searchParams.get('url') || '').indexOf('https://itunes.apple.com') === 0
      ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' // Apple rechaza a veces User-Agents desconocidos
      : 'Digz/1.0 (' + CONTACT_EMAIL + ')';
    const cors = {'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'X-Upstream-Status'};
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
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
