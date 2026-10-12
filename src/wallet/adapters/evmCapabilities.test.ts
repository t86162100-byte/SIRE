import test from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_CHAIN_REGISTRY } from '../chainRegistry';
import { getAdapterCapabilityReport } from './evmCapabilities';

test('EVM capability claims stay gated until operation tests exist', () => {
  const ethereum = WALLET_CHAIN_REGISTRY.find(chain => chain.id === 'ethereum')!;
  const report = getAdapterCapabilityReport(ethereum);
  assert.ok(report.implemented.includes('sign-transaction'));
  assert.ok(report.implemented.includes('broadcast-transaction'));
  assert.equal(report.canAdvertiseSendReceive, false);
  assert.equal(report.canAdvertiseFull, false);
});

test('non-EVM chains expose no EVM operations', () => {
  const bitcoin = WALLET_CHAIN_REGISTRY.find(chain => chain.id === 'bitcoin')!;
  const report = getAdapterCapabilityReport(bitcoin);
  assert.deepEqual(report.implemented, []);
  assert.equal(report.canAdvertiseSendReceive, false);
  assert.equal(report.canAdvertiseFull, false);
});
