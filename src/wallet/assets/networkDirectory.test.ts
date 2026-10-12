import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvmNetworkDirectory } from './networkDirectory';

test('network directory rejects testnets, placeholder RPCs and duplicate/known chain IDs', () => {
  const networks = parseEvmNetworkDirectory([
    { name: 'Example Mainnet', shortName: 'example', chainId: 123, network: 'mainnet', nativeCurrency: { name: 'Example', symbol: 'EX', decimals: 18 }, rpc: ['https://rpc.example.org'] },
    { name: 'Example Duplicate', shortName: 'dup', chainId: 123, nativeCurrency: { name: 'Example', symbol: 'EX', decimals: 18 }, rpc: ['https://rpc2.example.org'] },
    { name: 'Known Chain', shortName: 'known', chainId: 1, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpc: ['https://rpc.example.org'] },
    { name: 'Example Sepolia', shortName: 'sepolia', chainId: 124, nativeCurrency: { name: 'Example', symbol: 'EX', decimals: 18 }, rpc: ['https://rpc.example.org'] },
    { name: 'Placeholder RPC', shortName: 'placeholder', chainId: 125, nativeCurrency: { name: 'Example', symbol: 'EX', decimals: 18 }, rpc: ['https://rpc.example.org/${API_KEY}'] },
  ], [1]);
  assert.deepEqual(networks.map(n => n.chainId), [123]);
  assert.equal(networks[0].id, 'evm-123');
});

test('network directory rejects malformed payloads', () => {
  assert.throws(() => parseEvmNetworkDirectory({}, []), /invalid response/);
});
