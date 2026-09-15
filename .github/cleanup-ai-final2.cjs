const fs = require('fs');
const path = require('path');
const root = process.cwd();
const indexPath = path.join(root, 'backend/index.ts');
let s = fs.readFileSync(indexPath, 'utf8');

function between(a, b) {
  const i = s.indexOf(a);
  if (i < 0) return;
  const j = s.indexOf(b, i);
  if (j < 0) throw new Error(`missing cleanup end marker: ${b}`);
  s = s.slice(0, i) + s.slice(j);
}

// Remove every remaining legacy chat/model implementation from the backend.
between('const SIRE_INTERACTION_TOOLS', 'function validTick');
between('const AI_MODELS = [', 'const BACKTEST_MAX_TICKS');
s = s.replace(/SIRE_MAX_ANALYSIS_TICKS/g, 'BACKTEST_MAX_TICKS');
s = s.replace(/SIRE_MAX_TICKS/g, 'BACKTEST_MAX_TICKS');
s = s.replace(/SIRE_MAX_STEPS/g, '18');

// Remove provider-specific chat/status routes while retaining SIRE's neutral research/data gateway.
for (const route of [
  '/api/sire/agent/chat',
  '/api/sire/openai/chat',
  '/api/sire/ai/status',
]) {
  const e = route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  s = s.replace(new RegExp(`\\n  '(?:GET|POST) ${e}': \\[\\s\\S]*?\\n  \\],`, 'g'), '');
}
fs.writeFileSync(indexPath, s.replace(/\n{3,}/g, '\n\n'));

// Make the HTTP server import the real neutral SIRE handler directly.
const serverPath = path.join(root, 'server.mjs');
let server = fs.readFileSync(serverPath, 'utf8');
server = server.replace(/\/\/ Normalize OpenRouter credentials[\s\S]*?const \{ handler \} = await import\('\.\/backend\/openrouter-team\.ts'\);\n/, "const { handler } = await import('./backend/index.ts');\n");
fs.writeFileSync(serverPath, server);

// Delete provider-specific files, provider-specific workflow history, and deployment notes that
// exist solely to describe the retired AI stack. Keep all market/data/research/autonomy code.
for (const rel of [
  'backend/openrouter-team.ts',
  'backend/openrouter-env.mjs',
  'backend/openrouter-native-fetch.mjs',
  '.github/workflows/fix-ai-model-routing.yml',
  '.github/workflows/fix-nvidia-request.yml',
  '.github/workflows/fix-sire-tool-calling.yml',
  '.github/workflows/upgrade-sire-intelligence.yml',
  'DEPLOY_AI_RUNTIME_2026-09-14.md',
  '.github/workflows/cleanup-legacy-ai.yml',
  '.github/workflows/cleanup-ai-v2.yml',
]) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) fs.rmSync(p);
}

// Remove provider dependencies from the package manifest; npm regenerates the lockfile.
const packagePath = path.join(root, 'package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!pkg[section]) continue;
    for (const name of Object.keys(pkg[section])) {
      if (/openrouter|openai|@google\/generative|gemini|nvidia|bazaar/i.test(name)) delete pkg[section][name];
    }
  }
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

// Remove this temporary cleanup tool and any previous temporary cleanup workflow.
for (const rel of ['.github/cleanup-ai-final.cjs', '.github/workflows/execute-ai-cleanup.yml']) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) fs.rmSync(p);
}

console.log('Second-pass provider-neutral cleanup applied.');
