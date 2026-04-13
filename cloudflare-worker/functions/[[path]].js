const ALLOWED_HOSTS = new Set([
  'oauth2.googleapis.com',
  'sheets.googleapis.com',
  'www.googleapis.com',
]);

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Key',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const proxyKey = request.headers.get('X-Proxy-Key');
  if (!env.PROXY_KEY || proxyKey !== env.PROXY_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 1) {
    return new Response('Usage: /{googleapis-host}/path', { status: 400 });
  }

  const targetHost = segments[0];
  if (!ALLOWED_HOSTS.has(targetHost)) {
    return new Response(`Host not allowed: ${targetHost}`, { status: 403 });
  }

  const targetPath = '/' + segments.slice(1).join('/');
  const targetUrl = `https://${targetHost}${targetPath}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete('X-Proxy-Key');
  headers.set('Host', targetHost);

  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'follow',
  });

  const resp = await fetch(proxyReq);

  const respHeaders = new Headers(resp.headers);
  respHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
  });
}
