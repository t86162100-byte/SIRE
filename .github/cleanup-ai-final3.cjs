const fs=require('fs'),path=require('path');
const root=process.cwd();
const index=path.join(root,'backend/index.ts');
let s=fs.readFileSync(index,'utf8');
function cut(a,b){const i=s.indexOf(a);if(i<0)return;const j=s.indexOf(b,i);if(j<0)throw new Error('missing end marker '+b);s=s.slice(0,i)+s.slice(j);}
// Everything between this system prompt and the first non-AI trading-analysis type is the old model/chat stack.
cut('const OPENAI_SYSTEM_INSTRUCTION = `','type StrategySpec');
// Remove provider-specific route properties from the router.
for(const route of ['/api/sire/ai/status','/api/sire/agent/chat','/api/sire/openai/chat']){
 const e=route.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');
 s=s.replace(new RegExp(`\\n  '(?:GET|POST) ${e}': \\[\\s\\S]*?\\n  \\],`,'g'),'');
}
// Remove stale provider-specific aliases if any survived the block cut.
s=s.replace(/\nconst SIRE_INTERACTION_TOOLS[\s\S]*?\nfunction validTick/, '\nfunction validTick');
s=s.replace(/SIRE_MAX_ANALYSIS_TICKS/g,'BACKTEST_MAX_TICKS').replace(/SIRE_MAX_TICKS/g,'BACKTEST_MAX_TICKS').replace(/SIRE_MAX_STEPS/g,'18');
fs.writeFileSync(index,s.replace(/\n{3,}/g,'\n\n'));

const server=path.join(root,'server.mjs');
let sv=fs.readFileSync(server,'utf8');
sv=sv.replace(/\/\/ Normalize OpenRouter credentials[\s\S]*?const \{ handler \} = await import\('\.\/backend\/openrouter-team\.ts'\);\n/,"const { handler } = await import('./backend/index.ts');\n");
fs.writeFileSync(server,sv);

for(const rel of [
 'backend/openrouter-team.ts','backend/openrouter-env.mjs','backend/openrouter-native-fetch.mjs',
 '.github/workflows/fix-ai-model-routing.yml','.github/workflows/fix-nvidia-request.yml','.github/workflows/fix-sire-tool-calling.yml','.github/workflows/upgrade-sire-intelligence.yml',
 'DEPLOY_AI_RUNTIME_2026-09-14.md','.github/workflows/cleanup-legacy-ai.yml','.github/workflows/cleanup-ai-v2.yml',
 '.github/cleanup-ai-final.cjs','.github/cleanup-ai-final2.cjs','.github/cleanup-ai-final3.cjs','.github/workflows/execute-ai-cleanup.yml']){
 const p=path.join(root,rel);if(fs.existsSync(p))fs.rmSync(p);
}
const pp=path.join(root,'package.json');
if(fs.existsSync(pp)){const pkg=JSON.parse(fs.readFileSync(pp,'utf8'));for(const sec of ['dependencies','devDependencies','optionalDependencies'])if(pkg[sec])for(const k of Object.keys(pkg[sec]))if(/openrouter|openai|@google\/generative|gemini|nvidia|bazaar/i.test(k))delete pkg[sec][k];fs.writeFileSync(pp,JSON.stringify(pkg,null,2)+'\n');}
console.log('Final legacy AI removal applied.');
