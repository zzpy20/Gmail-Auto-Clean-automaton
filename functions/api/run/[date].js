export async function onRequest(context) {
  const { params, env } = context;
  const date = params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Invalid date — use YYYY-MM-DD format.' }, 400);
  }

  const data = await env.GMAIL_DIGEST_KV.get(date, { type: 'json' });
  if (!data) {
    return json({ error: `No digest saved for ${date}.` }, 404);
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
