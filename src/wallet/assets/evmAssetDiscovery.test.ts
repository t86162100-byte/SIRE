import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { discoverEvmAssets } from './evmAssetDiscovery';
import { getWalletChain } from '../chainRegistry';

const erc20 = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
]);

function mockRpc() {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    let result = '0x1';
    if (request.method === 'eth_chainId') result = '0x1';
    if (request.method === 'eth_getBalance') result = '0x2a';
    if (request.method === 'eth_call') {
      const call = request.params[0] as { data: string };
      const selector = call.data.slice(0, 10);
      if (selector === erc20.getFunction('name')!.selector) result = erc20.encodeFunctionResult('name', ['Example Token']);
      else if (selector === erc20.getFunction('symbol')!.selector) result = erc20.encodeFunctionResult('symbol', ['EXT']);
      else if (selector === erc20.getFunction('decimals')!.selector) result = erc20.encodeFunctionResult('decimals', [6]);
      else result = erc20.encodeFunctionResult('balanceOf', [1234567n]);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('discovers native balance and explicitly supplied token metadata without assuming 18 decimals', async () => {
  const chain = getWalletChain('ethereum')!;
  const result = await discoverEvmAssets({
    chain,
    address: '0x0000000000000000000000000000000000000001',
    tokenContracts: ['0x0000000000000000000000000000000000000002'],
    fetchImpl: mockRpc(),
  });
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].balanceBaseUnits, '42');
  assert.equal(result.assets[1].symbol, 'EXT');
  assert.equal(result.assets[1].decimals, 6);
  assert.equal(result.assets[1].balanceBaseUnits, '1234567');
  assert.equal(result.warnings.length, 0);
});

test('deduplicates token contracts and warns on invalid addresses', async () => {
  const result = await discoverEvmAssets({
    chain: getWalletChain('ethereum')!,
    address: '0x0000000000000000000000000000000000000001',
    tokenContracts: ['0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000002', 'not-an-address'],
    fetchImpl: mockRpc(),
  });
  assert.equal(result.assets.length, 2);
  assert.equal(result.warnings.length, 1);
});

test('refuses to use EVM discovery for a listed-only non-EVM chain', async () => {
  await assert.rejects(() => discoverEvmAssets({
    chain: getWalletChain('bitcoin')!,
    address: '0x0000000000000000000000000000000000000001',
    fetchImpl: mockRpc(),
  }), /does not have a configured EVM discovery adapter/);
});
