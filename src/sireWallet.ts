import { HDNodeWallet, JsonRpcProvider, Wallet, type TransactionRequest } from 'ethers';

export type SireChainFamily='evm';
export type SireNetwork={id:string;name:string;family:SireChainFamily;chainId:number;nativeSymbol:string;nativeName:string;rpcUrls:string[];explorerUrl:string};
export type SireAsset={id:string;networkId:string;kind:'native'|'token';symbol:string;name:string;decimals:number;contractAddress?:string;balance?:string;priceUsd?:number;verified?:boolean};

const STORAGE_KEY='sire.wallet.v2';
export const SIRE_NETWORKS:SireNetwork[]=[
{id:'ethereum',name:'Ethereum',family:'evm',chainId:1,nativeSymbol:'ETH',nativeName:'Ether',rpcUrls:['https://ethereum-rpc.publicnode.com','https://eth.llamarpc.com'],explorerUrl:'https://etherscan.io'},
{id:'base',name:'Base',family:'evm',chainId:8453,nativeSymbol:'ETH',nativeName:'Ether',rpcUrls:['https://mainnet.base.org','https://base-rpc.publicnode.com'],explorerUrl:'https://basescan.org'},
{id:'arbitrum-one',name:'Arbitrum One',family:'evm',chainId:42161,nativeSymbol:'ETH',nativeName:'Ether',rpcUrls:['https://arb1.arbitrum.io/rpc','https://arbitrum-one-rpc.publicnode.com'],explorerUrl:'https://arbiscan.io'},
{id:'optimism',name:'Optimism',family:'evm',chainId:10,nativeSymbol:'ETH',nativeName:'Ether',rpcUrls:['https://mainnet.optimism.io','https://optimism-rpc.publicnode.com'],explorerUrl:'https://optimistic.etherscan.io'},
{id:'bnb-smart-chain',name:'BNB Smart Chain',family:'evm',chainId:56,nativeSymbol:'BNB',nativeName:'BNB',rpcUrls:['https://bsc-dataseed.binance.org','https://bsc-rpc.publicnode.com'],explorerUrl:'https://bscscan.com'},
{id:'polygon',name:'Polygon',family:'evm',chainId:137,nativeSymbol:'POL',nativeName:'POL',rpcUrls:['https://polygon-rpc.com','https://polygon-bor-rpc.publicnode.com'],explorerUrl:'https://polygonscan.com'},
{id:'avalanche-c',name:'Avalanche C-Chain',family:'evm',chainId:43114,nativeSymbol:'AVAX',nativeName:'Avalanche',rpcUrls:['https://api.avax.network/ext/bc/C/rpc','https://avalanche-c-chain-rpc.publicnode.com'],explorerUrl:'https://snowtrace.io'}];
type StoredWallet={version:2;address:string;keystore:string;createdAt:string};
let unlocked:Wallet|HDNodeWallet|null=null;let pending:HDNodeWallet|null=null;
function storage(){if(typeof window==='undefined'||!window.localStorage)throw new Error('SIRE Wallet storage is unavailable in this browser.');return window.localStorage}
function stored():StoredWallet|null{if(typeof window==='undefined'||!window.localStorage)return null;const raw=window.localStorage.getItem(STORAGE_KEY);if(!raw)return null;try{const v=JSON.parse(raw) as StoredWallet;return v?.version===2&&v.address&&v.keystore?v:null}catch{return null}}
function save(w:Wallet|HDNodeWallet,k:string){storage().setItem(STORAGE_KEY,JSON.stringify({version:2,address:w.address,keystore:k,createdAt:new Date().toISOString()} satisfies StoredWallet))}
function passwordOk(p:string){if(typeof p!=='string'||p.length<8)throw new Error('Use a wallet password with at least 8 characters.')}
function emit(){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('sire:native-wallet-state',{detail:getWalletState()}))}
export function getWalletState(){const s=stored();return{hasWallet:Boolean(s),unlocked:Boolean(unlocked),address:unlocked?.address||s?.address||''}}
export function hasWallet(){return Boolean(stored())}
export function isWalletUnlocked(){return Boolean(unlocked)}
export function getWalletAddress(){return unlocked?.address||stored()?.address||''}
export function beginWalletCreation(){if(hasWallet())throw new Error('A SIRE Wallet already exists on this device.');pending=HDNodeWallet.createRandom();return{address:pending.address,mnemonic:pending.mnemonic?.phrase||''}}
export function cancelWalletCreation(){pending=null}
export async function finishWalletCreation(p:string){passwordOk(p);if(!pending)throw new Error('No wallet creation session is active.');if(hasWallet())throw new Error('A SIRE Wallet already exists on this device.');const w=pending;save(w,await w.encrypt(p));pending=null;unlocked=w;emit();return{address:w.address}}
export async function importWallet(m:string,p:string,i=0){passwordOk(p);if(hasWallet())throw new Error('A SIRE Wallet already exists on this device.');const phrase=m.trim().replace(/\s+/g,' ');if(!phrase)throw new Error('Enter a recovery phrase.');const w=HDNodeWallet.fromPhrase(phrase,undefined,`m/44'/60'/0'/0/${Math.max(0,Math.floor(i))}`);save(w,await w.encrypt(p));unlocked=w;emit();return{address:w.address}}
export async function unlockWallet(p:string){passwordOk(p);const s=stored();if(!s)throw new Error('No SIRE Wallet exists on this device.');const w=await Wallet.fromEncryptedJson(s.keystore,p);if(w.address.toLowerCase()!==s.address.toLowerCase())throw new Error('Wallet integrity check failed.');unlocked=w;emit();return{address:w.address}}
export function lockWallet(){unlocked=null;emit()}
export function removeWallet(){unlocked=null;pending=null;if(typeof window!=='undefined'&&window.localStorage)window.localStorage.removeItem(STORAGE_KEY);emit()}
export function getNetwork(id:string){const n=SIRE_NETWORKS.find(x=>x.id===id);if(!n)throw new Error('SIRE does not have a blockchain adapter for this network yet.');return n}
async function rpc(n:SireNetwork,m:string,p:unknown[]){let last:unknown;for(const url of n.rpcUrls){try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method:m,params:p})});const x=await r.json();if(!r.ok||x?.error)throw new Error(String(x?.error?.message||`RPC HTTP ${r.status}`));return x.result}catch(e){last=e}}throw last instanceof Error?last:new Error('All configured RPC endpoints are unavailable.')}
export async function getNativeBalance(id:string,address=getWalletAddress()){if(!address)return'0';return BigInt(await rpc(getNetwork(id),'eth_getBalance',[address,'latest'])).toString()}
export async function getTokenBalance(id:string,contract:string,address=getWalletAddress()){if(!address)return'0';if(!/^0x[0-9a-fA-F]{40}$/.test(contract))throw new Error('Invalid EVM token contract address.');const data=`0x70a08231${address.slice(2).padStart(64,'0')}`;return BigInt(await rpc(getNetwork(id),'eth_call',[{to:contract,data},'latest'])||'0x0').toString()}
export async function sendTransaction(id:string,request:TransactionRequest){if(!unlocked)throw new Error('Unlock SIRE Wallet before signing.');const n=getNetwork(id);const provider=new JsonRpcProvider(n.rpcUrls[0],n.chainId,{staticNetwork:true});const tx=await unlocked.connect(provider).populateTransaction({...request,from:unlocked.address,chainId:n.chainId});const signed=await unlocked.signTransaction(tx);return String(await rpc(n,'eth_sendRawTransaction',[signed]))}

// Compatibility exports for SIRE trading flows while the legacy wallet modules are removed.
export const hasNativeWallet=hasWallet;
export const isNativeWalletUnlocked=isWalletUnlocked;
export const getNativeWalletAddress=getWalletAddress;
export const prepareNativeWallet=beginWalletCreation;
export const cancelPreparedNativeWallet=cancelWalletCreation;
export const finalizePreparedNativeWallet=finishWalletCreation;
export const unlockNativeWallet=unlockWallet;
export function getNativeProvider(network:{chainId:number;rpcUrl?:string;rpcUrls?:string[]}){const url=network.rpcUrl||network.rpcUrls?.[0];if(!url)throw new Error('No RPC endpoint is configured for this network.');return new JsonRpcProvider(url,network.chainId,{staticNetwork:true});}
export async function sendNativeTransaction(network:{chainId:number;rpcUrl?:string;rpcUrls?:string[]},request:TransactionRequest){if(!unlocked)throw new Error('Unlock SIRE Wallet before signing.');const provider=getNativeProvider(network);const tx=await unlocked.connect(provider).populateTransaction({...request,from:unlocked.address,chainId:network.chainId});const signed=await unlocked.signTransaction(tx);const urls=network.rpcUrls?.length?network.rpcUrls:(network.rpcUrl?[network.rpcUrl]:[]);let last:unknown;for(const url of urls){try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method:'eth_sendRawTransaction',params:[signed]})});const p=await r.json();if(!r.ok||p?.error)throw new Error(String(p?.error?.message||`RPC HTTP ${r.status}`));const hash=String(p.result||'');if(!hash)throw new Error('RPC returned no transaction hash.');return{hash};}catch(e){last=e;}}throw last instanceof Error?last:new Error('Transaction RPCs are unavailable.');}
export async function waitForNativeTransaction(network:{chainId:number;rpcUrl?:string;rpcUrls?:string[]},hash:string,timeoutMs=180000){const provider=getNativeProvider(network);const started=Date.now();while(Date.now()-started<timeoutMs){const receipt=await provider.getTransactionReceipt(hash).catch(()=>null);if(receipt)return receipt;await new Promise(r=>setTimeout(r,1500));}throw new Error('Transaction confirmation timed out.');}
