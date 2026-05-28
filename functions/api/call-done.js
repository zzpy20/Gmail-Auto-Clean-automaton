export async function onRequest(context) {
  const { request, env } = context;
  const url   = new URL(request.url);
  const page  = url.searchParams.get('page')  || '0';
  const range = url.searchParams.get('range') || 'all';

  const appsScriptUrl = env.APPS_SCRIPT_URL;
  const token         = env.DASHBOARD_TOKEN;
  if (!appsScriptUrl || !token) {
    return json({ error: 'Worker not configured.' }, 500);
  }

  const upstream = await fetch(
    `${appsScriptUrl}?action=call_done&page=${page}&range=${encodeURIComponent(range)}&token=${encodeURIComponent(token)}`,
    { redirect: 'follow' }
  );
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
