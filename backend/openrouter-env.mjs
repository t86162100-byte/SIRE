// SIRE OpenRouter startup compatibility.
// Render deployments may have the key under a legacy alias. Normalize it before
// any SIRE module reads process.env.OPENROUTER_API_KEY. Never log the secret.
const aliases = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_KEY',
  'OPEN_ROUTER_API_KEY',
];

function normalize(value) {
  if (!value) return '';
  return String(value).trim().replace(/^['"]|['"]$/g, '').trim();
}

if (!normalize(process.env.OPENROUTER_API_KEY)) {
  for (const name of aliases.slice(1)) {
    const candidate = normalize(process.env[name]);
    if (candidate) {
      process.env.OPENROUTER_API_KEY = candidate;
      break;
    }
  }
}

// Keep the environment value clean when the canonical variable is already set.
const canonical = normalize(process.env.OPENROUTER_API_KEY);
if (canonical) process.env.OPENROUTER_API_KEY = canonical;
