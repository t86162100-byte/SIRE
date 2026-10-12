import test from 'node:test';
import assert from 'node:assert/strict';
import { getTokenCatalogUrl, parseTokenCatalog } from './tokenCatalog';

test('token catalog maps configured EVM chain IDs to chain-specific lists', () => {
  assert.equal(getTokenCatalogUrl(1), 'https://tokens.coingecko.com/ethereum/all.json');
  assert.equal(getTokenCatalogUrl(8453), 'https://tokens.coingecko.com/base/all.json');
  assert.equal(getTokenCatalogUrl(42161), 'https://tokens.coingecko.com/arbitrum-one/all.json');
  assert.equal(getTokenCatalogUrl(56), 'https://tokens.coingecko.com/binance-smart-chain/all.json');
  assert.equal(getTokenCatalogUrl(137), 'https://tokens.coingecko.com/polygon-pos/all.json');
  assert.equal(getTokenCatalogUrl(999999), null);
});

test('token catalog filters wrong-chain, malformed and duplicate token entries', () => {
  const tokens = parseTokenCatalog({ tokens: [
    { chainId: 1, address: '0x0000000000000000000000000000000000000001', name: 'One', symbol: 'ONE', decimals: 18 },
    { chainId: 1, address: '0x0000000000000000000000000000000000000001', name: 'Duplicate', symbol: 'DUP', decimals: 18 },
    { chainId: 8453, address: '0x0000000000000000000000000000000000000002', name: 'Wrong chain', symbol: 'NO', decimals: 18 },
    { chainId: 1, address: 'not-an-address', name: 'Invalid', symbol: 'BAD', decimals: 18 },
    { chainId: 1, address: '0x0000000000000000000000000000000000000003', name: 'Bad decimals', symbol: 'BAD', decimals: -1 },
  ] }, 1);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].symbol, 'ONE');
});

test('token catalog rejects malformed response shapes', () => {
  assert.throws(() => parseTokenCatalog({}, 1), /invalid response/);
});
