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

export type SwapNetwork = {
  name: string;
  chainId: number;
  key: string;
  nativeSymbol: string;
  nativeName: string;
  logoURI?: string;
  rpcUrl?: string;
  rpcUrls?: string[];
};

let swapNetworkCatalog: SwapNetwork[] = [];

export const SWAP_NETWORKS: Record<string, SwapNetwork> = {};

export const EVM_SWAP_NETWORKS: SwapNetwork[] = [];

function replaceSwapNetworkCatalog(next: SwapNetwork[]) {
  swapNetworkCatalog = next;
  for (const key of Object.keys(SWAP_NETWORKS)) delete SWAP_NETWORKS[key];
  for (const network of next) SWAP_NETWORKS[network.name] = network;
  EVM_SWAP_NETWORKS.splice(0, EVM_SWAP_NETWORKS.length, ...next);
}

export async function fetchSupportedSwapNetworks(): Promise<SwapNetwork[]> {
  const url = new URL('https://li.quest/v1/chains');
  url.searchParams.set('chainTypes', 'EVM');
  const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Unable to load the live supported swap networks.');
  const body = await response.json();
  const raw = Array.isArray(body) ? body : body?.chains || [];
  const networks = raw
    .filter((chain:any) => chain?.mainnet !== false)
    .map((chain:any) => {
      const chainId = Number(chain?.id ?? chain?.chainId);
      const native = chain?.nativeCurrency || {};
      const nativeSymbol = String(chain?.coin || native?.symbol || '').toUpperCase();
      return {
        name: String(chain?.name || chain?.key || 'Unknown network'),
        chainId,
        key: String(chain?.key || chain?.id || chainId),
        nativeSymbol,
        nativeName: String(native?.name || nativeSymbol || chain?.name || 'Native'),
        logoURI: chain?.logoURI,
        rpcUrl: Array.isArray(chain?.rpcUrls) ? String(chain.rpcUrls[0] || '') : String(chain?.rpcUrl || ''),
        rpcUrls: Array.isArray(chain?.rpcUrls) ? chain.rpcUrls.map((url:any) => String(url)).filter(Boolean) : [],
      } satisfies SwapNetwork;
    })
    .filter((network:SwapNetwork) => Number.isFinite(network.chainId) && network.chainId > 0 && network.nativeSymbol)
    .filter((network:SwapNetwork, index:number, list:SwapNetwork[]) => list.findIndex(item => item.chainId === network.chainId) === index)
    .sort((a:SwapNetwork,b:SwapNetwork) => a.name.localeCompare(b.name));

  if (!networks.length) throw new Error('LI.FI returned no supported EVM mainnet networks.');
  replaceSwapNetworkCatalog(networks);
  return networks;
}

export function getSwapNetworkByChainId(chainId:number): SwapNetwork | undefined {
  return swapNetworkCatalog.find(network => network.chainId === chainId);
}

export const ETHEREUM_TOKENS: SwapToken[] = [];

import { getNativeProvider, getNativeWalletAddress, isNativeWalletUnlocked, sendNativeTransaction, waitForNativeTransaction } from './sireWalletCore';

export type Eip1193Provider = {
  request(args: { method: string; params?: any[] }): Promise<any>;
  on?: (event: string, handler: (...args:any[]) => void) => void;
  removeListener?: (event: string, handler: (...args:any[]) => void) => void;
};

let externalWalletProvider: Eip1193Provider | null = null;

export function setExternalWalletProvider(provider: Eip1193Provider | null) {
  externalWalletProvider = provider;
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (externalWalletProvider) return externalWalletProvider;
  if (typeof window === 'undefined') return null;
  return (window as any).ethereum || null;
}

function usesNativeWallet(address?: string) {
  const nativeAddress = getNativeWalletAddress();
  return Boolean(address && nativeAddress && isNativeWalletUnlocked() && address.toLowerCase() === nativeAddress.toLowerCase());
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

export async function switchToNetwork(network: SwapNetwork) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No EVM wallet provider detected. Connect a wallet first.');
  const current = Number.parseInt(String(await provider.request({method:'eth_chainId'})), 16);
  if (current === network.chainId) return;
  const chainId = '0x' + network.chainId.toString(16);
  try {
    await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId}] });
  } catch (error:any) {
    if (error?.code === 4902) throw new Error(network.name + ' is not configured in this wallet.');
    throw error;
  }
}

export async function switchToEthereum() {
  return switchToNetwork(SWAP_NETWORKS.Ethereum);
}

export async function readNetworkNativeBalance(address: string, network: SwapNetwork): Promise<string> {
  if (usesNativeWallet(address)) return (await getNativeProvider(network).getBalance(address)).toString();
  const provider = getInjectedProvider();
  if (provider) return BigInt(await provider.request({method:'eth_getBalance', params:[address,'latest']})).toString();
  return '0';
}

export async function readEthBalance(address: string): Promise<string> {
  return readNetworkNativeBalance(address, SWAP_NETWORKS.Ethereum);
}

const ERC20_BALANCE_OF = '0x70a08231';
const ERC20_ALLOWANCE = '0xdd62ed3e';
function padAddress(address:string) { return address.toLowerCase().replace(/^0x/,'').padStart(64,'0'); }

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
function isNativeTokenAddress(address:string) {
  const value = String(address || '').toLowerCase();
  return value === NATIVE_ETH.toLowerCase() || value === ZERO_ADDRESS;
}

export async function readTokenBalance(token: SwapToken, owner: string): Promise<string> {
  if (token.native) {
    const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === token.chainId);
    return network ? readNetworkNativeBalance(owner, network) : '0';
  }
  const nativeOwner = usesNativeWallet(owner);
  const provider = nativeOwner ? null : getInjectedProvider();
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === token.chainId);
  const data = ERC20_BALANCE_OF + padAddress(owner);
  if (provider) {
    const result = await provider.request({method:'eth_call', params:[{to:token.address,data},'latest']});
    return BigInt(result || '0x0').toString();
  }
  if (!network || !isNativeWalletUnlocked() || owner.toLowerCase() !== getNativeWalletAddress().toLowerCase()) return '0';
  const result = await getNativeProvider(network).call({to: token.address, data});
  return BigInt(result || '0x0').toString();
}

export async function readAllowance(token: SwapToken, owner: string, spender: string): Promise<string> {
  if (token.native) return '0';
  const nativeOwner = usesNativeWallet(owner);
  const provider = nativeOwner ? null : getInjectedProvider();
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === token.chainId);
  const data = ERC20_ALLOWANCE + padAddress(owner) + padAddress(spender);
  if (provider) {
    const result = await provider.request({method:'eth_call', params:[{to:token.address,data},'latest']});
    return BigInt(result || '0x0').toString();
  }
  if (!network || !isNativeWalletUnlocked() || owner.toLowerCase() !== getNativeWalletAddress().toLowerCase()) return '0';
  const result = await getNativeProvider(network).call({to: token.address, data});
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
  const provider = usesNativeWallet(owner) ? null : getInjectedProvider();
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === token.chainId);
  if (!network) throw new Error('Unsupported approval network.');
  onStatus?.('Approval required');
  if (provider) {
    const hash = await provider.request({method:'eth_sendTransaction', params:[{
      from:owner, to:token.address, data:encodeApprove(spender, amount), value:'0x0'
    }]});
    onStatus?.('Waiting for approval');
    await waitForReceipt(hash);
    return;
  }
  if (!isNativeWalletUnlocked() || owner.toLowerCase() !== getNativeWalletAddress().toLowerCase()) throw new Error('Unlock SIRE Wallet before approving.');
  const tx = await sendNativeTransaction(network, {to: token.address, data: encodeApprove(spender, amount), value: 0n});
  onStatus?.('Waiting for approval');
  const receipt = await waitForNativeTransaction(network, tx.hash);
  if (receipt.status === 0) throw new Error('Approval transaction reverted.');
}

export async function fetchNetworkTokens(network: SwapNetwork, query=''): Promise<SwapToken[]> {
  const native: SwapToken = {
    symbol: network.nativeSymbol, name: network.nativeName, address:NATIVE_ETH,
    decimals:18, chainId:network.chainId, native:true
  };
  try {
    const url = new URL('https://li.quest/v1/tokens');
    url.searchParams.set('chains', String(network.chainId));
    const response = await fetch(url.toString(), {headers:{accept:'application/json'}});
    if (!response.ok) throw new Error('token catalogue unavailable');
    const body = await response.json();
    const raw = Array.isArray(body) ? body : body?.tokens?.[String(network.chainId)] || body?.tokens || [];
    const list = Array.isArray(raw) ? raw : [];
    const normalized = list.map((t:any)=>({
      symbol:String(t.symbol||'').toUpperCase(),
      name:String(t.name||t.symbol||'Token'),
      address:String(t.address || NATIVE_ETH),
      decimals:Number(t.decimals ?? 18),
      chainId:network.chainId,
      logoURI:t.logoURI,
      priceUSD:Number(t.priceUSD||0)||undefined,
      native:isNativeTokenAddress(String(t.address || '')) ||
        String(t.coinKey||'').toUpperCase()===network.nativeSymbol.toUpperCase(),
    })).filter((t:SwapToken)=>t.symbol && t.address && t.chainId === network.chainId);
    const merged = [native, ...normalized].filter((t,i,a)=>a.findIndex(x=>x.address.toLowerCase()===t.address.toLowerCase())===i);
    const q=query.trim().toLowerCase();
    return (q ? merged.filter(t=>t.symbol.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)||t.address.toLowerCase()===q) : merged).slice(0,2000);
  } catch (error) {
    throw new Error('Unable to load the live token catalogue for ' + network.name + '. Please try again.');
  }
}

export async function fetchEthereumTokens(query=''): Promise<SwapToken[]> {
  return fetchNetworkTokens(SWAP_NETWORKS.Ethereum, query);
}

export type SwapRouteOrder = 'FASTEST' | 'CHEAPEST';
const BITGET_CHAIN_KEYS: Record<number,string> = {
  1:'eth', 10:'op', 56:'bnb', 137:'polygon', 8453:'base', 42161:'arb', 43114:'avax_c', 324:'zk', 59144:'linea', 534352:'scroll', 81457:'blast', 5000:'mantle', 34443:'mode'
};
function getBitgetChainKey(chainId:number) { return BITGET_CHAIN_KEYS[chainId]; }
async function bitgetSwapRequest(path:string, body:any) {
  const response = await fetch('/api/sire/swap/bitget/' + path, { method:'POST', headers:{'content-type':'application/json','accept':'application/json'}, body:JSON.stringify(body) });
  const raw = await response.text(); let payload:any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || 'Bitget Wallet swap service is unavailable.'));
  return payload?.data ?? payload;
}
async function getBitgetQuote(args:{fromToken:SwapToken;toToken:SwapToken;amount:string;wallet:string;slippage:number;toAddress:string}):Promise<SwapQuote> {
  const fromChain=getBitgetChainKey(args.fromToken.chainId), toChain=getBitgetChainKey(args.toToken.chainId);
  if (!fromChain || !toChain) throw new Error('Bitget Wallet does not support this EVM network in SIRE yet.');
  const data=await bitgetSwapRequest('quote',{
    fromSymbol:args.fromToken.symbol,fromContract:args.fromToken.native?'':args.fromToken.address,fromAmount:args.amount,fromChain,
    toSymbol:args.toToken.symbol,toContract:args.toToken.native?'':args.toToken.address,toChain,
    fromAddress:args.wallet,toAddress:args.toAddress,txOrigin:args.wallet,estimateGas:true,amountUnit:'token'
  });
  const toAmount=String(data?.toAmount||'0'); if (!toAmount || toAmount==='0') throw new Error('Bitget Wallet returned no output amount.');
  const priceImpact=Number(data?.priceImpact), feeUSD=Number(data?.fee?.totalAmountInUsd), gasUSD=Number(data?.fee?.gasFee?.amountInUsd);
  return {
    id:String(data?.id||data?.orderId||''),tool:'bitget-wallet',toolName:'Bitget Wallet',
    fromAmount:amountToBaseUnits(args.amount,args.fromToken),toAmount:amountToBaseUnits(toAmount,args.toToken),
    toAmountMin:amountToBaseUnits(String(data?.toMinAmount||toAmount),args.toToken),fromToken:args.fromToken,toToken:args.toToken,
    gasUSD:Number.isFinite(gasUSD)?String(gasUSD):(Number.isFinite(feeUSD)?String(feeUSD):undefined),
    executionDuration:Number(data?.executionDuration||0)||undefined,
    priceImpact:Number.isFinite(priceImpact)?priceImpact:undefined,
    expiresAt:Number(data?.expiresAt||0)>0?Number(data.expiresAt)*1000:Date.now()+15000,
    raw:{provider:'bitget-wallet',chain:{from:fromChain,to:toChain},market:data?.market,features:data?.features||[],fee:data?.fee||{},quote:data}
  };
}
export async function prepareBitgetSwap(args:{quote:SwapQuote;wallet:string;slippage:number;toAddress:string}):Promise<SwapQuote> {
  const fromChain=getBitgetChainKey(args.quote.fromToken.chainId), toChain=getBitgetChainKey(args.quote.toToken.chainId);
  const market=String(args.quote.raw?.market||'');
  if (!fromChain || !toChain || !market) throw new Error('Bitget Wallet quote cannot be prepared for this route.');
  const data=await bitgetSwapRequest('swap',{
    fromSymbol:args.quote.fromToken.symbol,fromContract:args.quote.fromToken.native?'':args.quote.fromToken.address,fromAmount:args.quote.fromAmount,fromChain,
    toSymbol:args.quote.toToken.symbol,toContract:args.quote.toToken.native?'':args.quote.toToken.address,toChain,
    toMinAmount:args.quote.toAmountMin,fromAddress:args.wallet,toAddress:args.toAddress,txOrigin:args.wallet,
    slippage:args.slippage*100,market,amountUnit:'token',requestMod:'simple'
  });
  const txs=Array.isArray(data?.txs)?data.txs:[];
  const tx=txs.length===1 && txs[0]?.data ? {...txs[0].data, chainId:txs[0]?.chainId||txs[0]?.data?.chainId} : txs[txs.length-1];
  if (!tx?.to || !tx?.calldata) throw new Error('Bitget Wallet did not return executable EVM calldata.');
  return {
    ...args.quote,id:String(data?.id||args.quote.id||''),
    toAmount:amountToBaseUnits(String(data?.toAmount||formatUnits(args.quote.toAmount,args.quote.toToken.decimals,18)),args.quote.toToken),
    toAmountMin:amountToBaseUnits(String(data?.minToAmount||data?.toMinAmount||formatUnits(args.quote.toAmountMin,args.quote.toToken.decimals,18)),args.quote.toToken),
    approvalAddress:String(data?.contract||''),
    transactionRequest:{from:args.wallet,to:String(data.contract||tx.to),data:String(data.calldata||tx.calldata),value:String(tx.value||'0'),gas:tx.gasLimit?String(tx.gasLimit):undefined,gasLimit:tx.gasLimit?String(tx.gasLimit):undefined,gasPrice:tx.gasPrice?String(tx.gasPrice):undefined,chainId:Number(tx.chainId||args.quote.fromToken.chainId)},
    expiresAt:Number(data?.expiresAt||0)>0?Number(data.expiresAt)*1000:Date.now()+120000,
    raw:{...args.quote.raw,provider:'bitget-wallet',executable:data}
  };
}


export type SwapQuoteFailureReason =
  | 'INSUFFICIENT_LIQUIDITY'
  | 'AMOUNT_UNSUPPORTED'
  | 'TOOL_UNAVAILABLE'
  | 'PRICE_IMPACT_TOO_HIGH'
  | 'INSUFFICIENT_FUNDS'
  | 'WALLET_RESTRICTION'
  | 'NO_ROUTE';

export class SwapQuoteUnavailableError extends Error {
  reason: SwapQuoteFailureReason;
  providerCode?: number | string;
  providerMessage?: string;

  constructor(reason:SwapQuoteFailureReason, message:string, providerCode?:number|string, providerMessage?:string) {
    super(message);
    this.name = 'SwapQuoteUnavailableError';
    this.reason = reason;
    this.providerCode = providerCode;
    this.providerMessage = providerMessage;
  }
}

function classifySwapQuoteFailure(status:number, code:any, message:string):SwapQuoteFailureReason {
  const text = String(message || '').toLowerCase();
  const numericCode = Number(code);
  if (numericCode === 1001 || /insufficient.*fund|not enough.*fund|balance.*low|wallet.*fund/.test(text)) return 'INSUFFICIENT_FUNDS';
  if (/price.?impact|impact.*threshold|price impact/.test(text)) return 'PRICE_IMPACT_TOO_HIGH';
  if (/amount.*(too small|too large)|too small|too large|min(imum)?.*amount|max(imum)?.*amount/.test(text)) return 'AMOUNT_UNSUPPORTED';
  if (/liquidity|no liquidity|insufficient liquidity/.test(text)) return 'INSUFFICIENT_LIQUIDITY';
  if (/bridge|dex|exchange|temporarily unavailable|service unavailable|unavailable/.test(text)) return 'TOOL_UNAVAILABLE';
  if (/wallet|contract|account.*restrict|not supported.*wallet|restriction/.test(text)) return 'WALLET_RESTRICTION';
  return 'NO_ROUTE';
}

export function formatSwapQuoteFailure(reason:SwapQuoteFailureReason, tokenSymbol?:string) {
  switch (reason) {
    case 'INSUFFICIENT_FUNDS': return 'The selected route requires ' + (tokenSymbol || 'the source token') + ' balance before LI.FI can return an executable transaction. SIRE does not fake a funded wallet or substitute another address.';
    case 'INSUFFICIENT_LIQUIDITY': return 'No live route has enough liquidity for this amount right now.';
    case 'AMOUNT_UNSUPPORTED': return 'This amount is outside the currently supported range for the available pools or bridge.';
    case 'TOOL_UNAVAILABLE': return 'The available bridge or DEX is temporarily unavailable. Try again in a moment.';
    case 'PRICE_IMPACT_TOO_HIGH': return 'Available routes exceed SIRE’s maximum price-impact threshold.';
    case 'WALLET_RESTRICTION': return 'The selected wallet or contract has a route-specific restriction.';
    default: return 'No executable route is available for this token pair right now.';
  }
}

export async function getSwapQuote(args:{
  fromToken:SwapToken; toToken:SwapToken; amount:string; wallet:string; slippage:number; toAddress?:string; order?:SwapRouteOrder;
}):Promise<SwapQuote> {
  const effectiveRecipient=args.toAddress?.trim()||args.wallet;
  if (getBitgetChainKey(args.fromToken.chainId) && getBitgetChainKey(args.toToken.chainId)) {
    try { return await getBitgetQuote({...args,toAddress:effectiveRecipient}); }
    catch (error) { console.warn('[SIRE SWAP] Bitget quote unavailable; falling back to LI.FI:', error instanceof Error ? error.message : String(error)); }
  }
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === args.fromToken.chainId);
  if (!network || !EVM_SWAP_NETWORKS.some(n => n.chainId === network.chainId)) {
    throw new Error('This network requires its native wallet/router adapter and is not an EVM route.');
  }
  const destinationNetwork = Object.values(SWAP_NETWORKS).find(n => n.chainId === args.toToken.chainId);
  if (!destinationNetwork || !EVM_SWAP_NETWORKS.some(n => n.chainId === destinationNetwork.chainId)) {
    throw new Error('The destination network requires its native wallet/router adapter and is not an EVM route.');
  }
  const fromAmount = amountToBaseUnits(args.amount,args.fromToken);
  if (BigInt(fromAmount) <= 0n) throw new Error('Enter an amount greater than zero.');
  const url = new URL('https://li.quest/v1/quote');
  url.searchParams.set('fromChain',String(network.chainId));
  url.searchParams.set('toChain',String(destinationNetwork.chainId));
  url.searchParams.set('fromToken',args.fromToken.address);
  url.searchParams.set('toToken',args.toToken.address);
  url.searchParams.set('fromAddress',args.wallet);
  url.searchParams.set('toAddress',args.toAddress?.trim() || args.wallet);
  url.searchParams.set('fromAmount',fromAmount);
  url.searchParams.set('slippage',String(args.slippage));
  url.searchParams.set('order',args.order || 'CHEAPEST');
  url.searchParams.set('integrator','sire');
  // Keep the interactive quote responsive. We validate the executable transaction
  // separately in Test Mode; LI.FI documents skipSimulation as the faster quote path.
  url.searchParams.set('skipSimulation','true');
  url.searchParams.set('maxPriceImpact','0.15');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(url.toString(), {headers:{accept:'application/json'}, signal:controller.signal});
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error('Swap quote timed out. Please try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const rawText = await response.text();
  if (!response.ok) {
    let message = rawText;
    let providerCode:any;
    try {
      const body=JSON.parse(rawText);
      message=body?.message || body?.error || body?.details || message;
      providerCode=body?.code ?? body?.errorCode ?? body?.statusCode;
    } catch {}
    const reason = classifySwapQuoteFailure(response.status, providerCode, message);
    throw new SwapQuoteUnavailableError(
      reason,
      formatSwapQuoteFailure(reason, args.fromToken.symbol),
      providerCode,
      String(message).slice(0, 240)
    );
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

export type SwapSimulationResult = {
  gasEstimate?: string;
  approvalGasEstimate?: string;
  checkedAt: number;
};

/**
 * Safe no-money validation. This never signs, sends, approves, or broadcasts.
 * eth_call/eth_estimateGas execute against current chain state only.
 */
export async function simulateSwap(quote: SwapQuote, owner: string): Promise<SwapSimulationResult> {
  if (quote.expiresAt && Date.now() >= quote.expiresAt) {
    throw new Error('This quote has expired. Request a fresh quote before testing.');
  }
  const tx = quote.transactionRequest;
  if (!tx?.to) throw new Error('Quote did not return an executable transaction.');
  if (!owner) throw new Error('A wallet address is required for simulation.');
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === quote.fromToken.chainId);
  if (!network || !EVM_SWAP_NETWORKS.some(n => n.chainId === network.chainId)) {
    throw new Error('Simulation currently supports EVM networks only.');
  }
  if (tx.chainId && Number(tx.chainId) !== network.chainId) {
    throw new Error('Quote network does not match the selected network.');
  }

  const provider = getNativeProvider(network);
  const call = {
    from: owner,
    to: tx.to,
    data: tx.data || '0x',
    value: tx.value ? BigInt(tx.value) : 0n,
    ...(tx.gasLimit ? { gasLimit: BigInt(tx.gasLimit) } : tx.gas ? { gasLimit: BigInt(tx.gas) } : {}),
  };

  // For ERC-20 swaps, test the current allowance first. If allowance is insufficient,
  // estimate the approval transaction separately, but never submit it.
  let approvalGasEstimate: string | undefined;
  if (!quote.fromToken.native) {
    if (!quote.approvalAddress) throw new Error('The executable quote did not provide an approval spender.');
    const allowance = await readAllowance(quote.fromToken, owner, quote.approvalAddress);
    if (BigInt(allowance) < BigInt(quote.fromAmount)) {
      const approvalData = encodeApprove(quote.approvalAddress, quote.fromAmount);
      const approvalGas = await provider.estimateGas({ from: owner, to: quote.fromToken.address, data: approvalData, value: 0n });
      approvalGasEstimate = approvalGas.toString();
      throw new Error('Test reached the approval step. The swap route is valid enough to estimate approval, but the live swap cannot execute until that approval exists. No transaction was sent.');
    }
  }

  const gas = await provider.estimateGas(call);
  return { gasEstimate: gas.toString(), approvalGasEstimate, checkedAt: Date.now() };
}

export type SwapStatus = {
  status?: string;
  substatus?: string;
  transactionId?: string;
  sending?: { txHash?: string };
  receiving?: { txHash?: string };
  error?: string;
  substatusMessage?: string;
};

export async function fetchSwapStatus(args:{
  txHash:string;
  fromChain:number;
  toChain:number;
  bridge?:string;
}):Promise<SwapStatus> {
  const url = new URL('https://li.quest/v1/status');
  url.searchParams.set('txHash', args.txHash);
  url.searchParams.set('fromChain', String(args.fromChain));
  url.searchParams.set('toChain', String(args.toChain));
  if (args.bridge) url.searchParams.set('bridge', args.bridge);
  const response = await fetch(url.toString(), {headers:{accept:'application/json'}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.message || body?.error || 'Unable to read swap status.'));
  return body as SwapStatus;
}

export async function executeSwap(quote:SwapQuote, owner:string, onStatus?:(s:string)=>void) {
  if (quote.tool==='bitget-wallet') {
    const recipient=quote.raw?.quote?.toAddress||owner;
    const prepared=quote.transactionRequest?.to ? quote : await prepareBitgetSwap({quote,wallet:owner,slippage:0.005,toAddress:recipient});
    const tx=prepared.transactionRequest; if(!tx?.to) throw new Error('Bitget Wallet did not return an executable transaction.');
    if(tx.from && tx.from.toLowerCase()!==owner.toLowerCase()) throw new Error('The executable Bitget quote belongs to a different wallet.');
    const network=Object.values(SWAP_NETWORKS).find(n=>n.chainId===prepared.fromToken.chainId); if(!network) throw new Error('Unsupported Bitget Wallet network.');
    const provider=usesNativeWallet(owner)?null:getInjectedProvider();
    if(!provider && (!isNativeWalletUnlocked() || owner.toLowerCase()!==getNativeWalletAddress().toLowerCase())) throw new Error('Connect an external wallet or unlock SIRE Wallet before signing.');
    if(!usesNativeWallet(owner)) await switchToNetwork(network);
    const currentBalance=await readTokenBalance(prepared.fromToken,owner);
    if(BigInt(currentBalance)<BigInt(prepared.fromAmount)) throw new Error('Insufficient '+prepared.fromToken.symbol+' balance.');
    if(!prepared.fromToken.native && prepared.approvalAddress) await approveIfNeeded(prepared.fromToken,owner,prepared.approvalAddress,prepared.fromAmount,onStatus);
    onStatus?.('Confirm swap in wallet');
    if(provider){
      const hash=await provider.request({method:'eth_sendTransaction',params:[{from:owner,to:tx.to,data:tx.data||'0x',value:tx.value||'0x0',...(tx.gasLimit?{gas:tx.gasLimit}:tx.gas?{gas:tx.gas}:{}),...(tx.gasPrice?{gasPrice:tx.gasPrice}:{})}]});
      onStatus?.('Waiting for confirmation'); const receipt=await waitForReceipt(hash); return {hash,receipt};
    }
    const nativeTx=await sendNativeTransaction(network,{to:tx.to,data:tx.data||'0x',value:tx.value?BigInt(tx.value):0n,...(tx.gasLimit?{gasLimit:BigInt(tx.gasLimit)}:tx.gas?{gasLimit:BigInt(tx.gas)}:{}),...(tx.gasPrice?{gasPrice:BigInt(tx.gasPrice)}:{})});
    onStatus?.('Waiting for confirmation'); const receipt=await waitForNativeTransaction(network,nativeTx.hash);
    if(receipt.status===0) throw new Error('Swap transaction reverted.');
    return {hash:nativeTx.hash,receipt};
  }

  const provider=usesNativeWallet(owner) ? null : getInjectedProvider();
  if (quote.expiresAt && Date.now() >= quote.expiresAt) throw new Error('This quote has expired. Requesting a fresh quote is required.');
  if (!provider && (!isNativeWalletUnlocked() || owner.toLowerCase() !== getNativeWalletAddress().toLowerCase())) throw new Error('Connect an external wallet or unlock SIRE Wallet before signing.');
  if (!quote.transactionRequest?.to) throw new Error('Quote did not return an executable transaction.');
  const network = Object.values(SWAP_NETWORKS).find(n => n.chainId === quote.fromToken.chainId);
  if (!network || !EVM_SWAP_NETWORKS.some(n => n.chainId === network.chainId)) throw new Error('Unsupported EVM network.');
  // SIRE Wallet uses its own RPC signer; only external wallets need an injected-provider network switch.
  if (!usesNativeWallet(owner)) await switchToNetwork(network);
  if (quote.transactionRequest.from && quote.transactionRequest.from.toLowerCase() !== owner.toLowerCase()) throw new Error('The executable quote belongs to a different wallet. Request a fresh quote.');
  const currentBalance = await readTokenBalance(quote.fromToken, owner);
  if (BigInt(currentBalance) < BigInt(quote.fromAmount)) throw new Error('Insufficient ' + quote.fromToken.symbol + ' balance. The available balance changed after the quote was created.');
  if (!quote.fromToken.native && !quote.approvalAddress) throw new Error('The executable quote did not provide an approval spender.');
  await approveIfNeeded(quote.fromToken,owner,quote.approvalAddress||'',quote.fromAmount,onStatus);
  onStatus?.('Confirm swap in wallet');
  const tx=quote.transactionRequest;
  if (!tx.chainId || Number(tx.chainId) !== network.chainId) throw new Error('The executable transaction is for the wrong network. Request a fresh quote.');
  if (provider) {
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
  const nativeTx = await sendNativeTransaction(network, {
    to: tx.to,
    data: tx.data || '0x',
    value: tx.value ? BigInt(tx.value) : 0n,
    ...(tx.gasLimit ? {gasLimit: BigInt(tx.gasLimit)} : tx.gas ? {gasLimit: BigInt(tx.gas)} : {}),
    ...(tx.gasPrice ? {gasPrice: BigInt(tx.gasPrice)} : {}),
  });
  onStatus?.('Waiting for confirmation');
  const receipt = await waitForNativeTransaction(network, nativeTx.hash);
  if (receipt.status === 0) throw new Error('Swap transaction reverted.');
  return {hash:nativeTx.hash,receipt};
}
