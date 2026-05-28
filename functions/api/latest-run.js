export async function onRequest(context) {
  const { env } = context;

  // Try KV first (written by Apps Script after each run)
  if (env.GMAIL_DIGEST_KV) {
    const data = await env.GMAIL_DIGEST_KV.get('latest', { type: 'json' });
    if (data) {
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  }

  // Fallback: fetch directly from Apps Script (before first KV write)
  const appsScriptUrl = env.APPS_SCRIPT_URL;
  const token = env.DASHBOARD_TOKEN;
  if (!appsScriptUrl || !token) {
    return json({ error: 'Worker not configured — set APPS_SCRIPT_URL and DASHBOARD_TOKEN.' }, 500);
  }

  const url = `${appsScriptUrl}?action=latest_run&token=${encodeURIComponent(token)}`;
  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return json({ error: `Upstream fetch failed: ${err.message}` }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
