import https from 'node:https';

const OPENROUTER_HOST = 'openrouter.ai';
const OPENROUTER_ORIGIN = 'https://openrouter.ai/';
const originalFetch = globalThis.fetch.bind(globalThis);

function toHeaderObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers));
}

function normalizeKey(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function nativeOpenRouterFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== OPENROUTER_ORIGIN) return originalFetch(input, init);

  const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
  const headers = toHeaderObject(init.headers || (typeof input === 'object' ? input.headers : undefined));
  const key = normalizeKey(process.env.OPENROUTER_API_KEY);
  if (key) headers.authorization = `Bearer ${key}`;
  headers.accept ||= 'application/json';

  let body = init.body;
  if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
    body = String(body);
  }
  if (body !== undefined && body !== null) headers['content-length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: OPENROUTER_HOST,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: Number(process.env.OPENROUTER_NATIVE_TIMEOUT_MS || 30000),
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
          else if (value != null) responseHeaders.set(name, String(value));
        }
        resolve(new Response(raw, {
          status: response.statusCode || 0,
          statusText: response.statusMessage || '',
          headers: responseHeaders,
        }));
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('OpenRouter native HTTPS request timed out.')));
    request.on('error', reject);
    if (body !== undefined && body !== null) request.write(body);
    request.end();
  });
}

globalThis.fetch = nativeOpenRouterFetch;
console.log('[SIRE OpenRouter] Native HTTPS transport enabled; authorization is injected server-side.');
