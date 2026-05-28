export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const token = env.DASHBOARD_TOKEN;
  if (!token || request.headers.get('X-Dashboard-Token') !== token) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const date = (data.run_time || new Date().toISOString()).slice(0, 10);

  await env.GMAIL_DIGEST_KV.put(date, JSON.stringify(data));
  await env.GMAIL_DIGEST_KV.put('latest', JSON.stringify(data));

  return json({ ok: true, date });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
