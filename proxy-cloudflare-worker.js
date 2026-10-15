// Proxy CORS propio para Digz (Cloudflare Workers, plan gratis).
// Uso en la app: Ajustes > Conexión y fuentes > Proxy propio = https://TU-WORKER.workers.dev/
const OK = ['api.deezer.com','itunes.apple.com','musicbrainz.org','www.theaudiodb.com',
  'ws.audioscrobbler.com','coverartarchive.org','en.wikipedia.org','es.wikipedia.org'];
export default {
  async fetch(req) {
    const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'*'};
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
    const t = new URL(req.url).searchParams.get('url');
    let u; try { u = new URL(t); } catch (e) { return new Response('bad url', {status: 400, headers: cors}); }
    if (!OK.includes(u.hostname)) return new Response('host not allowed', {status: 403, headers: cors});
    const r = await fetch(u.toString(), {
      headers: {'User-Agent': 'Digz/1.0 (personal music library)', 'Accept': 'application/json'},
      cf: {cacheTtl: 300, cacheEverything: true}
    });
    const h = new Headers(r.headers);
    for (const k in cors) h.set(k, cors[k]);
    return new Response(r.body, {status: r.status, headers: h});
  }
};
