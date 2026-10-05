export type SwapToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  priceUSD?: number;
  native?: boolean;
};

export type SwapQuote = {
  id?: string;
  tool?: string;
  toolName?: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  fromToken: SwapToken;
  toToken: SwapToken;
  approvalAddress?: string;
  transactionRequest?: {
    from: string;
    to: string;
    data?: string;
    value?: string;
    gas?: string;
    gasLimit?: string;
    gasPrice?: string;
    chainId?: number;
  };
  gasAmount?: string;
  gasUSD?: string;
  executionDuration?: number;
  priceImpact?: number;
  expiresAt: number;
  raw: any;
};

export const ETHEREUM_CHAIN_ID = 1;
export const NATIVE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const ETHEREUM_TOKENS: SwapToken[] = [
  { symbol:'ETH', name:'Ethereum', address:NATIVE_ETH, decimals:18, chainId:1, native:true, logoURI:'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol:'USDT', name:'Tether', address:'0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals:6, chainId:1, logoURI:'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  { symbol:'USDC', name:'USD Coin', address:'0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals:6, chainId:1, logoURI:'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
  { symbol:'WBTC', name:'Wrapped Bitcoin', address:'0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals:8, chainId:1, logoURI:'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png' },
  { symbol:'DAI', name:'Dai', address:'0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals:18, chainId:1, logoURI:'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png' },
];

export type Eip1193Provider = {
  request(args: { method: string; params?: any[] }): Promise<any>;
  on?: (event: string, handler: (...args:any[]) => void) => void;
  removeListener?: (event: string, handler: (...args:any[]) => void) => void;
};

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  return (window as any).ethereum || null;
}

function parseUnits(value: string, decimals: number): string {
  const clean = String(value || '').trim();
  if (!/^\d*(\.\d*)?$/.test(clean) || !clean) throw new Error('Enter a valid amount.');
  const [whole, fraction=''] = clean.split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(padded || '0') + '';
}

export function formatUnits(value: string, decimals: number, maxFraction = 6): string {
  try {
    const n = BigInt(value || '0');
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const fraction = (n % base).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '0';
  }
}

export function amountToBaseUnits(amount: string, token: SwapToken) {
  return parseUnits(amount, token.decimals);
}

export async function connectWallet(): Promise<{ address:string; chainId:number }> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No browser wallet detected. Install MetaMask or another EVM wallet.');
  const accounts = await provider.request({ method:'eth_requestAccounts' });
  const address = String(accounts?.[0] || '');
  if (!address) throw new Error('Wallet did not return an account.');
  const chainHex = await provider.request({ method:'eth_chainId' });
  return { address, chainId: Number.parseInt(String(chainHex), 16) };
}

export async function switchToEthereum() {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No browser wallet detected.');
  const current = Number.parseInt(String(await provider.request({method:'eth_chainId'})), 16);
  if (current === 1) return;
  try {
    await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId:'0x1'}] });
  } catch (error:any) {
    if (error?.code === 4902) throw new Error('Ethereum network is not configured in this wallet.');
    throw error;
  }
}

export async function readEthBalance(address: string): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) return '0';
  return BigInt(await provider.request({method:'eth_getBalance', params:[address,'latest']})).toString();
}

const ERC20_BALANCE_OF = '0x70a08231';
const ERC20_ALLOWANCE = '0xdd62ed3e';
function padAddress(address:string) { return address.toLowerCase().replace(/^0x/,'').padStart(64,'0'); }

export async function readTokenBalance(token: SwapToken, owner: string): Promise<string> {
  if (token.native) return readEthBalance(owner);
  const provider = getInjectedProvider();
  if (!provider) return '0';
  const data = ERC20_BALANCE_OF + padAddress(owner);
  const result = await provider.request({method:'eth_call', params:[{to:token.address,data},'latest']});
  return BigInt(result || '0x0').toString();
}

export async function readAllowance(token: SwapToken, owner: string, spender: string): Promise<string> {
  if (token.native) return '0';
  const provider = getInjectedProvider();
  if (!provider) return '0';
  const data = ERC20_ALLOWANCE + padAddress(owner) + padAddress(spender);
  const result = await provider.request({method:'eth_call', params:[{to:token.address,data},'latest']});
  return BigInt(result || '0x0').toString();
}

function encodeApprove(spender:string, amount:string) {
  return '0x095ea7b3' + padAddress(spender) + BigInt(amount).toString(16).padStart(64,'0');
}

async function waitForReceipt(hash:string, timeoutMs=180000) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('Wallet provider unavailable.');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await provider.request({method:'eth_getTransactionReceipt', params:[hash]});
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('Blockchain transaction reverted.');
      return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('Transaction confirmation timed out. Check your wallet or block explorer.');
}

export async function approveIfNeeded(token:SwapToken, owner:string, spender:string, amount:string, onStatus?:(s:string)=>void) {
  if (token.native) return;
  const allowance = await readAllowance(token, owner, spender);
  if (BigInt(allowance) >= BigInt(amount)) return;
  const provider = getInjectedProvider();
  if (!provider) throw new Error('Wallet provider unavailable.');
  onStatus?.('Approval required');
  const hash = await provider.request({method:'eth_sendTransaction', params:[{
    from:owner, to:token.address, data:encodeApprove(spender, amount), value:'0x0'
  }]});
  onStatus?.('Waiting for approval');
  await waitForReceipt(hash);
}

export async function fetchEthereumTokens(query=''): Promise<SwapToken[]> {
  const fallback = ETHEREUM_TOKENS;
  try {
    const url = new URL('https://li.quest/v1/tokens');
    url.searchParams.set('chains','1');
    const response = await fetch(url.toString(), { headers:{accept:'application/json'} });
    if (!response.ok) throw new Error('token catalogue unavailable');
    const body = await response.json();
    const raw = Array.isArray(body) ? body : body?.tokens?.['1'] || body?.tokens || [];
    const list = Array.isArray(raw) ? raw : [];
    const normalized = list.map((t:any)=>({
      symbol:String(t.symbol||'').toUpperCase(),
      name:String(t.name||t.symbol||'Token'),
      address:String(t.address || NATIVE_ETH),
      decimals:Number(t.decimals ?? 18),
      chainId:1,
      logoURI:t.logoURI,
      priceUSD:Number(t.priceUSD||0)||undefined,
      native:String(t.address||'').toLowerCase()===NATIVE_ETH.toLowerCase() || String(t.coinKey||'').toUpperCase()==='ETH',
    })).filter((t:SwapToken)=>t.symbol && t.address);
    const merged = [...fallback, ...normalized].filter((t,i,a)=>a.findIndex(x=>x.address.toLowerCase()===t.address.toLowerCase())===i);
    const q=query.trim().toLowerCase();
    return (q ? merged.filter(t=>t.symbol.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)||t.address.toLowerCase()===q) : merged).slice(0,2000);
  } catch {
    const q=query.trim().toLowerCase();
    return q ? fallback.filter(t=>t.symbol.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)) : fallback;
  }
}

export async function getSwapQuote(args:{
  fromToken:SwapToken; toToken:SwapToken; amount:string; wallet:string; slippage:number;
}):Promise<SwapQuote> {
  const fromAmount = amountToBaseUnits(args.amount,args.fromToken);
  if (BigInt(fromAmount) <= 0n) throw new Error('Enter an amount greater than zero.');
  const url = new URL('https://li.quest/v1/quote');
  url.searchParams.set('fromChain','1');
  url.searchParams.set('toChain','1');
  url.searchParams.set('fromToken',args.fromToken.address);
  url.searchParams.set('toToken',args.toToken.address);
  url.searchParams.set('fromAddress',args.wallet);
  url.searchParams.set('toAddress',args.wallet);
  url.searchParams.set('fromAmount',fromAmount);
  url.searchParams.set('slippage',String(args.slippage));
  url.searchParams.set('order','CHEAPEST');
  url.searchParams.set('integrator','sire');
  const response = await fetch(url.toString(), {headers:{accept:'application/json'}});
  const rawText = await response.text();
  if (!response.ok) {
    let message = rawText;
    try { const body=JSON.parse(rawText); message=body?.message || body?.error || message; } catch {}
    throw new Error(`Swap quote unavailable (${response.status}): ${message.slice(0,180)}`);
  }
  const body = JSON.parse(rawText);
  const estimate=body?.estimate||{};
  const tx=body?.transactionRequest||null;
  const gas = Array.isArray(estimate.gasCosts) ? estimate.gasCosts[0] : null;
  return {
    id:body?.id, tool:body?.tool, toolName:body?.toolDetails?.name || body?.tool,
    fromAmount:estimate.fromAmount||fromAmount, toAmount:estimate.toAmount||'0', toAmountMin:estimate.toAmountMin||estimate.toAmount||'0',
    fromToken:args.fromToken, toToken:args.toToken, approvalAddress:estimate.approvalAddress,
    transactionRequest:tx, gasAmount:gas?.amount, gasUSD:gas?.amountUSD, executionDuration:estimate.executionDuration,
    priceImpact:estimate.priceImpact,
    expiresAt: Number(body?.validUntil || body?.quote?.expiry || body?.estimate?.validUntil || 0) > 0 ? Number(body?.validUntil || body?.quote?.expiry || body?.estimate?.validUntil) * 1000 : Date.now() + 20_000,
    raw:body,
  };
}

export async function executeSwap(quote:SwapQuote, owner:string, onStatus?:(s:string)=>void) {
  const provider=getInjectedProvider();
  if (quote.expiresAt && Date.now() >= quote.expiresAt) throw new Error('This quote has expired. Requesting a fresh quote is required.');
  if (!provider) throw new Error('Wallet provider unavailable.');
  if (!quote.transactionRequest?.to) throw new Error('Quote did not return an executable transaction.');
  await switchToEthereum();
  if (!quote.fromToken.native && !quote.approvalAddress) throw new Error('The executable quote did not provide an approval spender.');
  await approveIfNeeded(quote.fromToken,owner,quote.approvalAddress||'',quote.fromAmount,onStatus);
  onStatus?.('Confirm swap in wallet');
  const tx=quote.transactionRequest;
  const hash=await provider.request({method:'eth_sendTransaction',params:[{
    from:owner,
    to:tx.to,
    data:tx.data||'0x',
    value:tx.value||'0x0',
    ...(tx.gasLimit ? {gas:tx.gasLimit} : tx.gas ? {gas:tx.gas} : {}),
    ...(tx.gasPrice ? {gasPrice:tx.gasPrice} : {}),
  }]});
  onStatus?.('Waiting for confirmation');
  const receipt=await waitForReceipt(hash);
  return {hash,receipt};
}
