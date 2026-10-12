import test from 'node:test';
import assert from 'node:assert/strict';
import { getMultiChainTokenCatalog } from './multiChainTokenCatalog';

test('non-EVM catalog uses a chain-specific Trust Wallet token directory', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /blockchains\/solana\/tokenlist\.json$/);
    return new Response(JSON.stringify({ tokens: [
      { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL', decimals: 9, logoURI: 'https://example.org/sol.png' },
      { address: '', name: 'bad', symbol: 'BAD', decimals: 9 },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const tokens = await getMultiChainTokenCatalog({ id: 'solana', family: 'solana' }, fetchImpl);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].symbol, 'SOL');
});
