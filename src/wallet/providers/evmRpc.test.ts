import test from 'node:test';
import assert from 'node:assert/strict';
import { requestEvmRpc } from './evmRpc';

function fakeFetch(handler: (url: string, body: { method: string; params: unknown[] }) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    const answer = await handler(url, body);
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('verifies chain ID before making the requested RPC call', async () => {
  const calls: string[] = [];
  const result = await requestEvmRpc<string>({ rpcUrls: ['https://rpc.example'], expectedChainId: 1, method: 'eth_blockNumber', params: [], fetchImpl: fakeFetch((_url, body) => { calls.push(body.method); return { body: { jsonrpc: '2.0', id: 1, result: body.method === 'eth_chainId' ? '0x1' : '0xabc' } }; }) });
  assert.equal(result, '0xabc');
  assert.deepEqual(calls, ['eth_chainId', 'eth_blockNumber']);
});

test('does not send the requested method to an endpoint on the wrong chain', async () => {
  const calls: string[] = [];
  await assert.rejects(() => requestEvmRpc({ rpcUrls: ['https://wrong.example'], expectedChainId: 8453, method: 'eth_sendRawTransaction', params: ['0xdeadbeef'], fetchImpl: fakeFetch((_url, body) => { calls.push(body.method); return { body: { jsonrpc: '2.0', id: 1, result: '0x1' } }; }) }), /chain mismatch/);
  assert.deepEqual(calls, ['eth_chainId']);
});

test('fails over when the first endpoint is on the wrong chain', async () => {
  const requestedAt: string[] = [];
  const result = await requestEvmRpc<string>({ rpcUrls: ['https://wrong.example', 'https://right.example'], expectedChainId: 8453, method: 'eth_blockNumber', params: [], fetchImpl: fakeFetch((url, body) => { if (body.method === 'eth_chainId') return { body: { result: url.includes('wrong') ? '0x1' : '0x2105' } }; requestedAt.push(url); return { body: { result: '0x1234' } }; }) });
  assert.equal(result, '0x1234');
  assert.deepEqual(requestedAt, ['https://right.example']);
});

test('rejects malformed JSON-RPC envelopes rather than treating missing result as success', async () => {
  await assert.rejects(() => requestEvmRpc({ rpcUrls: ['https://rpc.example'], expectedChainId: 1, method: 'eth_blockNumber', params: [], fetchImpl: fakeFetch((_url, body) => ({ body: { result: body.method === 'eth_chainId' ? '0x1' : undefined } })) }), /missing result/);
});
