import http from 'node:http';

const PORT = Number(process.env.PORT || 10000);
const BYBIT_BASES = [
  'https://api.bybit.com',
  'https://api.bytick.com',
];

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function proxy(path, query) {
  let lastError;
  for (const base of BYBIT_BASES) {
    try {
      const url = base + path + (query ? '?' + query : '');
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'SIRE-Bybit-Relay/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error('Bybit HTTP ' + response.status + ': ' + text.slice(0, 300));
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Bybit request failed');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'sire-bybit-relay' });
  if (url.pathname !== '/v5/market/instruments-info' &&
      url.pathname !== '/v5/market/option-base-coins' &&
      url.pathname !== '/v5/event/instruments-info') {
    return sendJson(res, 404, { ok: false, error: 'not found' });
  }
  try {
    const data = await proxy(url.pathname, url.searchParams.toString());
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 502, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[SIRE BYBIT RELAY] listening on ' + PORT);
});
