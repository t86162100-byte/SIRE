import test from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_CHAIN_REGISTRY, getWalletChain, getChainsByCapability } from './chainRegistry';

test('registry chain IDs are unique and every chain has a native asset definition', () => {
  const ids = WALLET_CHAIN_REGISTRY.map(chain => chain.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const chain of WALLET_CHAIN_REGISTRY) {
    assert.ok(chain.name.trim(), `missing name for ${chain.id}`);
    assert.ok(chain.nativeAsset.name.trim(), `missing native asset name for ${chain.id}`);
    assert.ok(chain.nativeAsset.symbol.trim(), `missing native asset symbol for ${chain.id}`);
    assert.ok(Number.isInteger(chain.nativeAsset.decimals) && chain.nativeAsset.decimals >= 0, `invalid decimals for ${chain.id}`);
  }
});

test('listed chains cannot accidentally expose RPC write paths', () => {
  for (const chain of getChainsByCapability('listed')) {
    assert.equal(chain.rpcUrls.length, 0, `${chain.id} is listed-only but has RPC endpoints`);
  }
});

test('only EVM chains currently have configured RPC endpoints', () => {
  for (const chain of WALLET_CHAIN_REGISTRY) {
    if (chain.family !== 'evm') {
      assert.equal(chain.status, 'listed', `${chain.id} must remain gated until a family adapter is verified`);
      assert.equal(chain.rpcUrls.length, 0, `${chain.id} has no verified RPC adapter`);
    }
  }
});

test('chain lookup is explicit and unknown chains are not silently mapped', () => {
  assert.equal(getWalletChain('ethereum')?.chainId, 1);
  assert.equal(getWalletChain('made-up-chain'), undefined);
});
