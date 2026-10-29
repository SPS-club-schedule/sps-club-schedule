import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import gateway from '../server/gateway/worker.mjs';
const secret = 'test-only-gateway-key';
const origin = 'https://sps-club-schedule.github.io';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const request = (path, options = {}) => new Request('https://sps-schedule.folderrewind.top' + path, options);

test('gateway forwards API bodies and sessions only to the fixed upstream, signs the real client IP and never caches', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://sps-club-api.sysu-physics-clubs.workers.dev/api');
    assert.equal(options.headers.get('Authorization'), 'Bearer test-session');
    assert.equal(options.headers.get('Origin'), origin);
    assert.equal(options.headers.get('Cookie'), null);
    assert.equal(options.headers.get('X-Forwarded-For'), null);
    assert.equal(options.headers.get('X-SPS-Gateway-IP'), '192.0.2.42');
    const time = options.headers.get('X-SPS-Gateway-Time');
    assert.equal(options.headers.get('X-SPS-Gateway-Signature'), createHmac('sha256', secret).update(`${time}\n192.0.2.42`).digest('hex'));
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cf.cacheTtl, 0);
    assert.equal(await new Response(options.body).text(), '{"action":"bootstrap"}');
    return Response.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401, headers: { 'Set-Cookie': 'unwanted=value', 'Cache-Control': 'public' } });
  };
  const response = await gateway.fetch(request('/api', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test-session', 'Content-Type': 'application/json', Cookie: 'secret=value', 'CF-Connecting-IP': '192.0.2.42', 'X-SPS-Gateway-IP': 'forged', 'X-Forwarded-For': 'forged' }, body: '{"action":"bootstrap"}' }), { GATEWAY_SIGNING_KEY: secret });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).code, 'UNAUTHENTICATED');
});

test('gateway rejects unrelated routes, arbitrary destinations, bad origins and methods before contacting upstream', async () => {
  globalThis.fetch = () => { throw new Error('Unexpected fetch'); };
  const env = { GATEWAY_SIGNING_KEY: secret };
  for (const path of ['/other', '/health?url=https://evil.test', '//evil.test/api']) assert.equal((await gateway.fetch(request(path), env)).status, 404);
  assert.equal((await gateway.fetch(request('/health', { headers: { Origin: origin + '.evil.test' } }), env)).status, 403);
  assert.equal((await gateway.fetch(request('/api', { method: 'GET' }), env)).status, 405);
  assert.equal((await gateway.fetch(request('/health'), {})).status, 503);
  const preflight = await gateway.fetch(request('/api', { method: 'OPTIONS', headers: { Origin: origin } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type,Authorization');
});

test('gateway handles upstream redirects, HTML errors and network failures without exposing credentials or internals', async () => {
  for (const upstream of [() => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), () => new Response('<html>error</html>', { status: 502 }), () => { throw new Error('internal details'); }]) {
    globalThis.fetch = upstream;
    const response = await gateway.fetch(request('/health'), { GATEWAY_SIGNING_KEY: secret });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
  }
});
