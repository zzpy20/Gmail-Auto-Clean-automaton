const CACHE_TTL = 1800; // 30 minutes

export async function onRequest(context) {
  const { request, env } = context;
  const url   = new URL(request.url);
  const page  = url.searchParams.get('page')  || '0';
  const range = url.searchParams.get('range') || 'all';
  const bust  = url.searchParams.get('refresh') === '1';

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  const token         = env.DASHBOARD_TOKEN;
  if (!appsScriptUrl || !token) return json({ error: 'Not configured.' }, 500);

  const cacheKey = `call-done::${range}::${page}`;

  // Serve from KV cache unless a forced refresh was requested
  if (!bust && env.GMAIL_DIGEST_KV) {
    const cached = await env.GMAIL_DIGEST_KV.get(cacheKey, { type: 'json' });
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
  }

  // Cache miss — fetch from Apps Script
  const upstream = await fetch(
    `${appsScriptUrl}?action=call_done&page=${page}&range=${encodeURIComponent(range)}&token=${encodeURIComponent(token)}`,
    { redirect: 'follow' }
  );
  const body = await upstream.text();

  // Write to KV cache on success
  if (upstream.ok && env.GMAIL_DIGEST_KV) {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data.items)) {
        await env.GMAIL_DIGEST_KV.put(cacheKey, body, { expirationTtl: CACHE_TTL });
      }
    } catch { /* ignore parse errors */ }
  }

  return new Response(body, {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
