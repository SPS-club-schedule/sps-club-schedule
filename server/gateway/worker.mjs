// Public API edge in Leafuke's account; state stays in the original Worker.
const UPSTREAM = 'https://sps-club-api.sysu-physics-clubs.workers.dev';
const ORIGINS = new Set(['https://sps-club-schedule.github.io', 'https://farawayshore.github.io']);
const POST_PATHS = new Set(['/api', '/auth/register', '/auth/login', '/auth/logout', '/auth/recover','/experience/upload','/experience/manage']);
const encoder = new TextEncoder();
export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    const reply = (status, message) => Response.json({ ok: false, message }, { status, headers });
    if (origin && !ORIGINS.has(origin)) return reply(403, '此网站未获授权');
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      headers.set('Access-Control-Max-Age', '86400');
    }
    const download=/^\/experience\/files\/x_[a-f0-9]{32}$/.test(url.pathname);
    const getPath=url.pathname==='/health'||url.pathname==='/experience'||download;
    if (url.search || !(POST_PATHS.has(url.pathname) || getPath)) return reply(404, '接口不存在');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!((request.method === 'GET' && getPath) || (request.method === 'POST' && POST_PATHS.has(url.pathname)))) return reply(405, '请求方式不支持');
    if (!env.GATEWAY_SIGNING_KEY) return reply(503, '服务暂时不可用，请稍后重试');
    // Forward only API headers. Never forward cookies or caller-provided IP proofs.
    const upstreamHeaders = new Headers();
    for (const name of ['Content-Type', 'Authorization', 'Origin']) {
      const value = request.headers.get(name); if (value) upstreamHeaders.set(name, value);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const time = String(Date.now());
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.GATEWAY_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const proof = await crypto.subtle.sign('HMAC', key, encoder.encode(`${time}\n${ip}`));
    upstreamHeaders.set('X-SPS-Gateway-IP', ip);
    upstreamHeaders.set('X-SPS-Gateway-Time', time);
    upstreamHeaders.set('X-SPS-Gateway-Signature', Array.from(new Uint8Array(proof), b => b.toString(16).padStart(2, '0')).join(''));
    try {
      const response = await fetch(UPSTREAM + url.pathname, {
        method: request.method, headers: upstreamHeaders,
        body: request.method === 'POST' ? request.body : undefined,
        redirect: 'manual', signal: AbortSignal.timeout(url.pathname==='/experience/upload'?55000:18000),
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      // Do not forward credentials through redirects, or return edge error HTML.
      if (response.status >= 300 && response.status < 400) return reply(502, '服务返回异常，请稍后重试');
      if(download && response.ok && response.headers.get('Content-Type')==='application/octet-stream' && response.headers.get('Content-Disposition')?.startsWith('attachment;')) {
        for(const name of ['Content-Type','Content-Disposition','Content-Length'])if(response.headers.has(name))headers.set(name,response.headers.get(name));
        headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
        return new Response(response.body,{status:response.status,headers});
      }
      if (!(response.headers.get('Content-Type') || '').includes('application/json')) return reply(502, '服务暂时不可用，请稍后重试');
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return reply(502, '连接失败，请稍后重试');
    }
  }
};
