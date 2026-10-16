const BASE = 'https://api.coinbase.com/api/v3/brokerage/market/products';
const LIMIT = 1000;
const MAX_PAGES = 100;

function classify(product) {
  const type = String(product?.product_type ?? '').toLowerCase();
  const expiry = String(product?.future_product_details?.contract_expiry_type ?? '').toLowerCase();
  const display = [
    product?.display_name,
    product?.product_id,
    product?.future_product_details?.contract_display_name,
  ].filter(Boolean).join(' ').toLowerCase();

  if (type === 'spot') return 'spot';
  if (type === 'future' && expiry === 'perpetual') return 'perpetual';
  if (type === 'future' || expiry === 'expiring') return 'future';
  if (display.includes('perpetual') || /(^|[-_])perp([-_]|$)/i.test(display)) return 'perpetual';
  return 'other';
}

async function page(params, cursor) {
  const query = new URLSearchParams({ limit: String(LIMIT), ...params });
  if (cursor) query.set('cursor', cursor);
  const response = await fetch(BASE + '?' + query);
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function all(params) {
  const result = [];
  let cursor = '';
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const data = await page(params, cursor);
    if (Array.isArray(data.products)) result.push(...data.products);
    const next = String(data?.pagination?.next_cursor ?? '').trim();
    if (!next || next === cursor) break;
    cursor = next;
  }
  return result;
}

const queries = [
  ['all', {}],
  ['spot', { product_type: 'SPOT' }],
  ['future', { product_type: 'FUTURE' }],
  ['perpetual', { product_type: 'FUTURE', contract_expiry_type: 'PERPETUAL' }],
];

const buckets = new Map();
for (const [name, params] of queries) {
  const products = await all(params);
  console.log(name + ': ' + products.length);
  for (const product of products) {
    const id = String(product?.product_id ?? '').trim();
    if (!id) throw new Error(name + ' returned a product without product_id');
    const previous = buckets.get(id);
    if (!previous) buckets.set(id, product);
  }
}

const products = [...buckets.values()];
const counts = { spot: 0, perpetual: 0, future: 0, other: 0 };
for (const product of products) counts[classify(product)] += 1;

console.log('unique Coinbase products: ' + products.length);
console.log('category counts: ' + JSON.stringify(counts));

if (!products.length) throw new Error('Coinbase returned zero products.');
if (counts.other) {
  console.log('Unclassified product IDs (kept visible, not dropped):');
  for (const product of products) {
    if (classify(product) === 'other') console.log('  ' + product.product_id);
  }
}
console.log('Coinbase catalogue verification passed: every returned product has a stable product_id and is retained.');
