import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SIRE_TRADING_MODE = 'LIVE';
process.env.BITGET_API_KEY = 'test-key';
process.env.BITGET_API_SECRET = 'test-secret';
process.env.BITGET_API_PASSPHRASE = 'test-passphrase';
delete process.env.BITGET_API_BASE_URL;

const originalFetch = globalThis.fetch;
const { bitgetOwnerPlaceOrder, bitgetOwnerPlaceTriggerOrder, bitgetOwnerSetFuturesLeverage, bitgetOwnerCancelOrder, bitgetOwnerAccount } = await import('./sire-provider-execution.ts');

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify({ code: '00000', msg: 'success', data }) };
}
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  return calls;
}
test.afterEach(() => { globalThis.fetch = originalFetch; process.env.SIRE_TRADING_MODE = 'LIVE'; });

test('Spot market and limit orders map to Bitget authenticated requests', async () => {
  const calls = mockFetch((url, options) => response({ orderId: '123456789012', clientOid: 'sire-test' }));
  const market = await bitgetOwnerPlaceOrder({ category: 'SPOT', symbol: 'BTCUSDT', side: 'buy', orderType: 'market', qty: '20', clientOid: 'sire-test-market' });
  assert.equal(market.provider, 'BITGET');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v3\/trade\/place-order$/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.category, 'SPOT');
  assert.equal(body.orderType, 'market');
  assert.equal(body.qty, '20');
  assert.equal(body.timeInForce, 'ioc');
  assert.equal(calls[0].options.headers['ACCESS-KEY'], 'test-key');

  calls.length = 0;
  await bitgetOwnerPlaceOrder({ category: 'SPOT', symbol: 'ETHUSDT', side: 'sell', orderType: 'limit', qty: '0.1', price: '2500', timeInForce: 'post_only' });
  const limit = JSON.parse(calls[0].options.body);
  assert.equal(limit.price, '2500');
  assert.equal(limit.timeInForce, 'post_only');
});

test('Futures orders read holding mode before sending a position-aware order', async () => {
  const calls = mockFetch((url) => url.endsWith('/api/v3/account/settings')
    ? response({ holdMode: 'hedge_mode' })
    : response({ orderId: '123456789013', clientOid: 'sire-futures' }));
  await bitgetOwnerPlaceOrder({ category: 'USDT-FUTURES', symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', qty: '0.001', price: '30000', posSide: 'long', marginMode: 'isolated', reduceOnly: 'no', timeInForce: 'gtc' });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.category, 'USDT-FUTURES');
  assert.equal(body.posSide, 'long');
  assert.equal(body.marginMode, 'isolated');
  assert.equal(body.reduceOnly, 'no');
});

test('Futures leverage uses the selected category, symbol, and margin mode', async () => {
  const calls = mockFetch(() => response({ leverage: '5' }));
  await bitgetOwnerSetFuturesLeverage({ category: 'COIN-FUTURES', symbol: 'BTCUSD', leverage: 5, marginMode: 'crossed' });
  assert.match(calls[0].url, /\/api\/v3\/account\/set-leverage$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { category: 'COIN-FUTURES', symbol: 'BTCUSD', leverage: '5', marginMode: 'crossed' });
});

test('trigger and trailing-stop order payloads are formed without network access', async () => {
  const calls = mockFetch(() => response({ orderId: '123456789014' }));
  await bitgetOwnerPlaceTriggerOrder({ category: 'SPOT', symbol: 'BTCUSDT', side: 'buy', qty: '0.001', triggerPrice: '50000', orderType: 'limit', price: '49900', planType: 'normal_plan', triggerType: 'mark_price' });
  const trigger = JSON.parse(calls[0].options.body);
  assert.equal(trigger.type, 'trigger');
  assert.equal(trigger.triggerBy, 'mark');
  assert.equal(trigger.triggerOrderPrice, '49900');

  calls.length = 0;
  await bitgetOwnerPlaceTriggerOrder({ category: 'USDT-FUTURES', symbol: 'BTCUSDT', side: 'sell', qty: '0.001', triggerPrice: '51000', callbackRatio: '0.5', orderType: 'market', planType: 'track_plan', posSide: 'short' });
  const trailing = JSON.parse(calls[0].options.body);
  assert.equal(trailing.type, 'trailing_stop');
  assert.equal(trailing.trailingStopParams.trailVariance, '0.5');
});

test('authenticated account reads return assets and equity; cancel order is routed to Bitget', async () => {
  const calls = mockFetch((url) => url.endsWith('/api/v3/account/assets')
    ? response({ accountEquity: '123.45', usdtEquity: '120', assets: [{ coin: 'USDT', available: '120' }] })
    : response({ orderId: '123456789015' }));
  const account = await bitgetOwnerAccount();
  assert.equal(account.accountEquity, '123.45');
  assert.equal(account.assets[0].coin, 'USDT');
  await bitgetOwnerCancelOrder({ category: 'SPOT', orderId: '123456789015' });
  assert.ok(calls.some(call => call.url.includes('/api/v3/trade/cancel-order')));
});

test('paper mode blocks authenticated write calls before fetch', async () => {
  process.env.SIRE_TRADING_MODE = 'PAPER';
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network must not be called'); };
  await assert.rejects(bitgetOwnerPlaceOrder({ category: 'SPOT', symbol: 'BTCUSDT', side: 'buy', orderType: 'market', qty: '10' }), /Safety lock/);
  assert.equal(networkCalls, 0);
});
