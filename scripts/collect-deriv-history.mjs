const BASE_URL = (process.env.SIRE_PUBLIC_URL || 'https://sire-rwv9.onrender.com').replace(/\/$/, '');
const MAX_CONCURRENCY = 4;
const COUNT = 100;

async function request(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const health = await fetch(`${BASE_URL}/api/sire/deriv/health`);
if (!health.ok) throw new Error(`Deriv health HTTP ${health.status}`);
const healthData = await health.json();
const symbols = Array.isArray(healthData.activeSymbols)
  ? healthData.activeSymbols
      .filter(item => Number(item?.exchange_is_open) === 1 && String(item?.market || '').toLowerCase() === 'synthetic_index')
      .map(item => String(item?.underlying_symbol || '').trim())
      .filter(Boolean)
  : [];

console.log(`[DERIV COLLECTOR] collecting ${COUNT} latest 1m candles for ${symbols.length} active synthetic symbols`);

let next = 0;
let ok = 0;
let failed = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= symbols.length) return;
    const symbol = symbols[index];
    try {
      const result = await request('/api/sire/deriv/history', { symbol, count: COUNT, granularity: 60, end: 'latest' });
      ok += 1;
      console.log(`[DERIV COLLECTOR] OK ${symbol} returned=${Array.isArray(result?.candles) ? result.candles.length : 0}`);
    } catch (error) {
      failed += 1;
      console.error(`[DERIV COLLECTOR] FAIL ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, symbols.length)) }, () => worker()));
console.log(`[DERIV COLLECTOR] complete ok=${ok} failed=${failed}`);
if (failed > Math.ceil(symbols.length * 0.25)) process.exitCode = 1;
