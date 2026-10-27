// Servidor de avisos push para Digz (Cloudflare Workers, plan gratis).
// Guía: ver LEEME-AVISOS.txt. Variables/secretos que necesita:
//   KV namespace  -> PUSH
//   Secreto       -> VAPID_PRIVATE  (la clave privada JWK, en una línea)
//   Variable      -> VAPID_PUBLIC   (la clave pública, ya incluida en la app)
//   Variable      -> CONTACT        (tu correo, ej. mailto:tu@correo.com)
//   Cron trigger  -> * * * * *   (cada minuto, para que el aviso llegue a la hora exacta)
const ORIGINS = ['https://ghosthardware99.github.io', 'https://localhost', 'http://localhost', 'capacitor://localhost'];
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha(t) { const h = await crypto.subtle.digest('SHA-256', enc.encode(t)); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32); }
let _key = null;
async function signKey(env) { if (!_key) _key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); return _key; }
async function vapid(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.CONTACT || 'mailto:admin@example.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signKey(env), enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC;
}
// Push sin contenido: la app (service worker) pregunta después qué mostrar con /last
async function push(env, endpoint) {
  return fetch(endpoint, { method: 'POST', headers: { Authorization: await vapid(env, endpoint), TTL: '86400', Urgency: 'high', 'Content-Length': '0' } });
}
const LEAD = 45000; // avisa como mucho 45 s antes de la hora programada
const dueAt = (p, off) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(p.d || ''), t = /^(\d\d):(\d\d)$/.exec(p.t || '09:00'); return m && t ? Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - (off || 0) * 60000 : Infinity; };
const todayOf = (now, off) => new Date(now + (off || 0) * 60000).toISOString().slice(0, 10);
const skey = (p) => p.k + '|' + p.d + '|' + p.t;
function nextDue(s, now) { const today = todayOf(now, s.off); let m = Infinity; for (const p of s.plans || []) { if (p.d < today || (s.sent || {})[skey(p)]) continue; m = Math.min(m, dueAt(p, s.off)); } return m; }
async function setIdx(env, id, v) { const idx = (await env.PUSH.get('idx', 'json')) || {}; if (v === Infinity || v == null) delete idx[id]; else idx[id] = v; await env.PUSH.put('idx', JSON.stringify(idx)); }
export default {
  async fetch(req, env) {
    const o = req.headers.get('Origin'), u = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' };
    const J = (x, s) => new Response(JSON.stringify(x), { status: s || 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (u.pathname === '/last') { const id = u.searchParams.get('id') || ''; if (!/^[0-9a-f]{32}$/.test(id)) return J({ items: [] }); return J(JSON.parse((await env.PUSH.get('l:' + id)) || '{"items":[]}')); }
      if (req.method !== 'POST') return J({ ok: true, name: 'digz-push' });
      const b = await req.json();
      if (u.pathname === '/sync') {
        const ep = b.sub && b.sub.endpoint; if (!ep || !/^https:\/\//.test(ep)) return J({ error: 'sub' }, 400);
        const id = await sha(ep), old = JSON.parse((await env.PUSH.get('s:' + id)) || '{}'), sent = old.sent || {}, keep = {};
        const plans = (b.plans || []).slice(0, 500).map(p => ({ k: String(p.k).slice(0, 200), ar: String(p.ar || '').slice(0, 120), al: String(p.al || '').slice(0, 160), d: String(p.d), t: /^\d\d:\d\d$/.test(p.t) ? p.t : '09:00' }));
        plans.forEach(p => { const x = p.k + '|' + p.d + '|' + p.t; if (sent[x]) keep[x] = 1; });
        await env.PUSH.put('s:' + id, JSON.stringify({ endpoint: ep, off: Math.max(-840, Math.min(840, +b.off || 0)), plans, sent: keep }));
        await setIdx(env, id, nextDue({ plans, sent: keep, off: Math.max(-840, Math.min(840, +b.off || 0)) }, Date.now()));
        return J({ ok: true, id });
      }
      if (u.pathname === '/unsub') { const id = await sha(b.endpoint || ''); await env.PUSH.delete('s:' + id); await env.PUSH.delete('l:' + id); await setIdx(env, id, null); return J({ ok: true }); }
      if (u.pathname === '/test') {
        const ep = b.endpoint || '', id = await sha(ep);
        await env.PUSH.put('l:' + id, JSON.stringify({ items: [{ al: 'Aviso de prueba', ar: 'Digz', d: '' }] }), { expirationTtl: 86400 });
        const r = await push(env, ep); return J({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
      }
    } catch (e) { return J({ error: String(e && e.message || e) }, 500); }
    return J({ error: 'not found' }, 404);
  },
  async scheduled(ev, env) {
    const now = Date.now();
    let idx = await env.PUSH.get('idx', 'json'), changed = false;
    // Reconstruye el índice si no existe y cada 30 min (por si algo quedó desfasado)
    if (!idx || new Date(now).getUTCMinutes() % 30 === 0) {
      idx = {}; changed = true; let cursor;
      do {
        const l = await env.PUSH.list({ prefix: 's:', cursor }); cursor = l.list_complete ? null : l.cursor;
        for (const kk of l.keys) { const s = JSON.parse((await env.PUSH.get(kk.name)) || 'null'); if (!s) continue; const n = nextDue(s, now); if (n !== Infinity) idx[kk.name.slice(2)] = n; }
      } while (cursor);
    }
    for (const id of Object.keys(idx)) {
      if (idx[id] > now + LEAD) continue;
      const s = JSON.parse((await env.PUSH.get('s:' + id)) || 'null'); if (!s) { delete idx[id]; changed = true; continue; }
      const today = todayOf(now, s.off), sent = s.sent || {};
      const due = (s.plans || []).filter(p => p.d === today && dueAt(p, s.off) <= now + LEAD && !sent[skey(p)]);
      if (due.length) {
        await env.PUSH.put('l:' + id, JSON.stringify({ items: due.map(p => ({ al: p.al, ar: p.ar, d: p.d, t: p.t })) }), { expirationTtl: 86400 });
        const r = await push(env, s.endpoint);
        if (r.status === 404 || r.status === 410) { await env.PUSH.delete('s:' + id); await env.PUSH.delete('l:' + id); delete idx[id]; changed = true; continue; }
        if (r.ok) { s.sent = sent; due.forEach(p => { sent[skey(p)] = 1; }); await env.PUSH.put('s:' + id, JSON.stringify(s)); }
      }
      const n = nextDue(s, now); if (n === Infinity) delete idx[id]; else idx[id] = n; changed = true;
    }
    if (changed) await env.PUSH.put('idx', JSON.stringify(idx));
  }
};
