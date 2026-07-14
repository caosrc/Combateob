import inner from '../worker-entry.js';

// ── PWA wrapper: garante headers corretos para Service Worker offline ──
export default {
  async fetch(req, env, ctx) {
    let res;
    try { res = await inner.fetch(req, env, ctx); }
    catch(e) { res = new Response('Error', {status: 500}); }

    const url = new URL(req.url);
    const p   = url.pathname;
    const h   = new Headers(res.headers);

    // Headers críticos para PWA funcionar offline
    if (p === '/sw.js') {
      h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      h.set('Service-Worker-Allowed', '/');
    } else if (p === '/manifest.json' || p.endsWith('.html') || p === '/') {
      h.set('Cache-Control', 'no-cache, must-revalidate');
    }

    // SPA routing: 404 em rotas sem extensão → serve /login.html
    if (res.status === 404 && req.method === 'GET' && !p.includes('.')) {
      const fallback = await env.ASSETS.fetch(new Request(url.origin + '/login.html', req));
      const fh = new Headers(fallback.headers);
      fh.set('Cache-Control', 'no-cache, must-revalidate');
      return new Response(fallback.body, { status: 200, headers: fh });
    }

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};
