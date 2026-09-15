const fs=require('fs'),path=require('path');
const root=process.cwd();
const index=path.join(root,'backend/index.ts');
let s=fs.readFileSync(index,'utf8');
function cut(a,b,replacement=''){const i=s.indexOf(a);if(i<0)return;const j=s.indexOf(b,i);if(j<0)throw new Error('missing marker '+b);s=s.slice(0,i)+replacement+s.slice(j);}
// Replace the entire old provider/model constants block with only neutral data limits.
cut('const AI_MODELS = [','const BACKTEST_MAX_TICKS = 100000;','const BACKTEST_MAX_TICKS = 100000;\nconst DATA_PAGE_LIMIT = 100;\nconst PAPER_TABLE = \'sire_paper_trades_v1\';\nconst DATA_MAX_PAGES = 120;\n\n');
// Remove the entire old system-prompt/model/tool-calling implementation.
cut('const OPENAI_SYSTEM_INSTRUCTION = `','type StrategySpec');
// Remove all provider-specific chat/status/tool routes as one contiguous legacy route section.
cut("  'GET /api/sire/ai/status': [","  'POST /api/sire/data/ensure': [");
// Remove any stale aliases/constants left by earlier partial passes.
s=s.replace(/^const OPENAI_[^\n]*\n/gm,'');
s=s.replace(/^const SIRE_MAX_[^\n]*\n/gm,'');
s=s.replace(/\bOPENAI_MAX_(?:STEPS|TICKS|ANALYSIS_TICKS)\b/g,'BACKTEST_MAX_TICKS');
s=s.replace(/\bOPENAI_MODEL\b/g,'');
s=s.replace(/\bAI_MODELS\b/g,'');
fs.writeFileSync(index,s.replace(/\n{3,}/g,'\n\n'));

const server=path.join(root,'server.mjs');
let sv=fs.readFileSync(server,'utf8');
sv=sv.replace(/\/\/ Normalize OpenRouter credentials[\s\S]*?const \{ handler \} = await import\('\.\/backend\/openrouter-team\.ts'\);\n/,"const { handler } = await import('./backend/index.ts');\n");
fs.writeFileSync(server,sv);

for(const rel of ['backend/openrouter-team.ts','backend/openrouter-env.mjs','backend/openrouter-native-fetch.mjs','.github/workflows/fix-ai-model-routing.yml','.github/workflows/fix-nvidia-request.yml','.github/workflows/fix-sire-tool-calling.yml','.github/workflows/upgrade-sire-intelligence.yml','DEPLOY_AI_RUNTIME_2026-09-14.md','.github/workflows/cleanup-legacy-ai.yml','.github/workflows/cleanup-ai-v2.yml','.github/cleanup-ai-final.cjs','.github/cleanup-ai-final2.cjs','.github/cleanup-ai-final3.cjs','.github/cleanup-ai-final4.cjs','.github/workflows/execute-ai-cleanup.yml']){const p=path.join(root,rel);if(fs.existsSync(p))fs.rmSync(p);}
const pp=path.join(root,'package.json');if(fs.existsSync(pp)){const pkg=JSON.parse(fs.readFileSync(pp,'utf8'));for(const sec of ['dependencies','devDependencies','optionalDependencies'])if(pkg[sec])for(const k of Object.keys(pkg[sec]))if(/openrouter|openai|@google\/generative|gemini|nvidia|bazaar/i.test(k))delete pkg[sec][k];fs.writeFileSync(pp,JSON.stringify(pkg,null,2)+'\n');}
console.log('Exact final cleanup applied.');
