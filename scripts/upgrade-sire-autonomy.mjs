import fs from 'node:fs';

const path = 'backend/index.ts';
let s = fs.readFileSync(path, 'utf8');

if (!s.includes("./sire-autonomy")) {
  s = s.replace("import { router, json, error, db } from '@appdeploy/sdk';", "import { router, json, error, db } from '@appdeploy/sdk';\nimport { ensureDerivHistory, analyzeM30Trend, autonomousEnvironmentAudit } from './sire-autonomy';");
}

const toolAnchor = "  { name: 'add_chart_marker', description: 'Action: place a marker at the current chart inspection/crosshair point. Use only when the user explicitly asks to mark the current point.', parameters: { type: 'OBJECT', properties: { label: { type: 'STRING' } } } },";
const toolInsert = `${toolAnchor}\n  { name: 'ensure_market_data', description: 'Autonomously acquire missing historical Deriv tick data for any catalogue instrument. Use this before technical analysis when persisted coverage is insufficient. Never require the user to select the market in the UI first.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, ticks: { type: 'NUMBER' } }, required: ['symbol'] } },\n  { name: 'analyze_m30_trend', description: 'Autonomously ensure enough Deriv history exists, construct M30 candles and return an evidence-based trend assessment. Use for requests such as checking the M30 trend of Boom 1000.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, candles: { type: 'NUMBER' } }, required: ['symbol'] } },`;
if (s.includes(toolAnchor) && !s.includes("name: 'ensure_market_data'")) s = s.replace(toolAnchor, toolInsert);

const mappingAnchor = "  if (name === 'add_chart_marker') return { __sireAction: 'add_chart_marker', label: String(args.label || 'SIRE marker') };";
const mappingInsert = `${mappingAnchor}\n  if (name === 'ensure_market_data') return ensureDerivHistory(String(args.symbol || '').trim(), Number(args.ticks || 10000));\n  if (name === 'analyze_m30_trend') return analyzeM30Trend(String(args.symbol || '').trim(), Number(args.candles || 250));`;
if (s.includes(mappingAnchor) && !s.includes("name === 'ensure_market_data'")) s = s.replace(mappingAnchor, mappingInsert);

const routeAnchor = "  'GET /api/_healthcheck': [";
const routeInsert = `  'POST /api/sire/data/ensure': [\n    async ({ body }) => {\n      const payload = (body || {}) as Record<string, unknown>;\n      const symbol = String(payload.symbol || '').trim();\n      if (!symbol) return error('symbol is required', 400);\n      try { return json({ ok: true, ...(await ensureDerivHistory(symbol, Number(payload.ticks || 10000))) }); }\n      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }\n    },\n  ],\n  'GET /api/sire/data/m30-trend': [\n    async ({ query }) => {\n      const symbol = String(query.symbol || '').trim();\n      if (!symbol) return error('symbol is required', 400);\n      try { return json({ ok: true, ...(await analyzeM30Trend(symbol, Number(query.candles || 250))) }); }\n      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }\n    },\n  ],\n  'GET /api/sire/environment/audit': [\n    async () => json({ ok: true, ...(await autonomousEnvironmentAudit()) }),\n  ],\n${routeAnchor}`;
if (s.includes(routeAnchor) && !s.includes("/api/sire/data/ensure")) s = s.replace(routeAnchor, routeInsert);

fs.writeFileSync(path, s);
console.log('SIRE autonomy wiring complete');
