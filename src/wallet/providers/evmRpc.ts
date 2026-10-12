export type JsonRpcEnvelope<T> = { jsonrpc?: string; id?: number; result?: T; error?: { code?: number; message?: string } };

export type EvmRpcOptions = {
  rpcUrls: readonly string[];
  expectedChainId: number;
  method: string;
  params: unknown[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

let requestId = 0;

async function postJson<T>(url: string, method: string, params: unknown[], timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    let payload: JsonRpcEnvelope<T>;
    try { payload = await response.json() as JsonRpcEnvelope<T>; }
    catch { throw new Error('RPC returned invalid JSON.'); }
    if (!payload || typeof payload !== 'object') throw new Error('RPC returned an invalid response.');
    if (payload.error) throw new Error(payload.error.message || `RPC error ${payload.error.code ?? 'unknown'}`);
    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) throw new Error('RPC response is missing result.');
    return payload.result as T;
  } finally { clearTimeout(timer); }
}

/** Chain-pinned RPC with bounded timeouts and endpoint failover. */
export async function requestEvmRpc<T>(options: EvmRpcOptions): Promise<T> {
  const { rpcUrls, expectedChainId, method, params, timeoutMs = 10_000, fetchImpl = fetch } = options;
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) throw new Error('Invalid expected EVM chain ID.');
  if (!rpcUrls.length) throw new Error('No RPC endpoints are configured for this network.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('RPC timeout must be positive.');
  let lastError: unknown;
  for (const url of rpcUrls) {
    try {
      const chainIdRaw = await postJson<string>(url, 'eth_chainId', [], timeoutMs, fetchImpl);
      let actualChainId: bigint;
      try { actualChainId = BigInt(chainIdRaw); } catch { throw new Error('RPC returned an invalid chain ID.'); }
      if (actualChainId !== BigInt(expectedChainId)) throw new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${actualChainId.toString()}.`);
      return await postJson<T>(url, method, params, timeoutMs, fetchImpl);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('All configured RPC endpoints failed.');
}
