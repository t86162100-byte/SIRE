import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SIRE_TRADING_MODE='PAPER';
delete process.env.BITGET_API_KEY;
delete process.env.BITGET_API_SECRET;
delete process.env.BITGET_API_PASSPHRASE;

const { bitgetOwnerPlaceOrder } = await import('./sire-provider-execution.ts');
const { runFuturesScheduleBatch } = await import('./futures-scheduler.ts');

test('paper mode blocks authenticated Bitget order writes before credentials or network access', async () => {
  await assert.rejects(
    bitgetOwnerPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'10'}),
    /Safety lock.*SIRE_TRADING_MODE=PAPER|Safety lock.*require SIRE_TRADING_MODE/
  );
});

test('paper and Bitget demo modes cannot start the live Futures scheduler', async () => {
  process.env.SIRE_TRADING_MODE='PAPER';
  assert.deepEqual(await runFuturesScheduleBatch(),{enabled:false,reason:'live_scheduler_safety_lock',processed:0});
  process.env.SIRE_TRADING_MODE='BITGET_DEMO';
  assert.deepEqual(await runFuturesScheduleBatch(),{enabled:false,reason:'live_scheduler_safety_lock',processed:0});
});
