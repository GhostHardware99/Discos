// Proxy CORS propio para Digz (Cloudflare Workers, plan gratis).
// Uso en la app: Ajustes > Conexión y fuentes > Proxy propio = https://TU-WORKER.workers.dev/
// >>> ESCRIBE TU CORREO ENTRE LAS COMILLAS (MusicBrainz lo pide). Es lo único que debes cambiar. <<<
const CONTACT_EMAIL = 'econoniso2008@gmail.com';
const OK = ['api.deezer.com','itunes.apple.com','musicbrainz.org','www.theaudiodb.com','api.discogs.com',
  'ws.audioscrobbler.com','coverartarchive.org','en.wikipedia.org','es.wikipedia.org'];
// Solo tu app (GitHub Pages) puede usar este proxy
const ORIGIN = 'https://ghosthardware99.github.io';
export default {
  async fetch(req) {
    const UA = 'Digz/1.0 (' + CONTACT_EMAIL + ')';
    const cors = {'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'*'};
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
    const t = new URL(req.url).searchParams.get('url');
    let u; try { u = new URL(t); } catch (e) { return new Response('bad url', {status: 400, headers: cors}); }
    if (u.protocol !== 'https:' || !OK.includes(u.hostname)) return new Response('host not allowed', {status: 403, headers: cors});
    const opts = {
      headers: {'User-Agent': UA, 'Accept': req.headers.get('Accept') || '*/*'},
      redirect: 'manual',
      cf: {cacheTtl: 300, cacheEverything: true, cacheTtlByStatus: {'200-299': 300, '300-399': 0, '400-599': 0}}
    };
    let r = await fetch(u.toString(), opts);
    // Sigue una redirección solo si va a otro dominio permitido
    if (r.status >= 300 && r.status < 400 && r.headers.get('Location')) {
      let n; try { n = new URL(r.headers.get('Location'), u); } catch (e) { return new Response('bad redirect', {status: 502, headers: cors}); }
      if (n.protocol !== 'https:' || !OK.includes(n.hostname)) return new Response('redirect not allowed', {status: 403, headers: cors});
      r = await fetch(n.toString(), opts);
    }
    const h = new Headers(r.headers);
    for (const k in cors) h.set(k, cors[k]);
    return new Response(r.body, {status: r.status, headers: h});
  }
};
