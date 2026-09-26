import { WebSocket } from 'ws';

const DERIV_PUBLIC_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const GITHUB_API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE';
const TOKEN = process.env.GITHUB_TOKEN;
const ISSUE_NUMBER = Number(process.env.AUTONOMOUS_STATE_ISSUE_NUMBER || '10');
const SYMBOLS = [...new Set(String(process.env.SIRE_AUTONOMOUS_SYMBOLS || 'WLDAUD')
  .split(',').map(s => s.trim()).filter(Boolean))].slice(0, 10);
const INTERVAL_SECONDS = Math.max(60, Number(process.env.SIRE_AUTONOMOUS_INTERVAL_SECONDS || '60'));
const RUNS_PER_JOB = Math.max(1, Number(process.env.SIRE_AUTONOMOUS_RUNS_PER_JOB || '5'));

if (!TOKEN) throw new Error('GITHUB_TOKEN is required.');
if (!ISSUE_NUMBER) throw new Error('AUTONOMOUS_STATE_ISSUE_NUMBER is required.');

function request(ws, payload, expectedType, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Deriv response: ${expectedType}`));
    }, timeoutMs);

    const onMessage = raw => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg?.error) {
        cleanup();
        reject(new Error(msg.error.message || 'Deriv request failed.'));
        return;
      }
      if (msg?.msg_type !== expectedType) return;
      cleanup();
      resolve(msg);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };

    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function getSnapshot() {
  const ws = new WebSocket(DERIV_PUBLIC_WS);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deriv WebSocket open timed out.')), 15000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', error => { clearTimeout(timer); reject(error); });
    });

    const catalogue = await request(ws, { active_symbols: 'brief', req_id: 1 }, 'active_symbols');
    const active = new Set((catalogue.active_symbols || []).map(x => String(x?.symbol || '')));
    const missing = SYMBOLS.filter(symbol => !active.has(symbol));
    if (missing.length) throw new Error(`Inactive/unverified symbols: ${missing.join(', ')}`);

    const symbols = {};
    let reqId = 10;
    for (const symbol of SYMBOLS) {
      const response = await request(ws, {
        ticks_history: symbol,
        end: 'latest',
        count: 100,
        style: 'candles',
        granularity: 60,
        subscribe: 0,
        req_id: reqId++,
      }, 'candles');

      const candles = (response.candles || []).map(c => ({
        epoch: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      })).filter(c => Object.values(c).every(Number.isFinite));

      symbols[symbol] = {
        timeframe: '1m',
        candleCount: candles.length,
        latestCandle: candles.at(-1) || null,
        candles,
      };
    }

    return {
      status: 'healthy',
      mode: 'free-periodic-observer',
      limitation: 'Free mode observes on a 60-second interval inside each scheduled job; GitHub Actions itself can only start scheduled jobs at a minimum 5-minute interval and may delay runs.',
      observedAt: new Date().toISOString(),
      symbols,
    };
  } finally {
    try { ws.close(); } catch {}
  }
}

async function updateIssue(state) {
  const url = `${GITHUB_API}/repos/${REPO}/issues/${ISSUE_NUMBER}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: [
        'This issue is maintained automatically by the free autonomous market observer. Do not edit manually.',
        '',
        '## Current state',
        '',
        'Status: ' + state.status,
        '',
        '```json',
        JSON.stringify(state, null, 2),
        '```',
      ].join('\\n'),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub issue update failed (${response.status}): ${body}`);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  for (let run = 0; run < RUNS_PER_JOB; run += 1) {
    const state = await getSnapshot();
    state.observationIntervalSeconds = INTERVAL_SECONDS;
    state.runInJob = run + 1;
    state.runsPerJob = RUNS_PER_JOB;
    await updateIssue(state);
    console.log(JSON.stringify({
      service: 'sire-free-autonomous-market-observer',
      event: 'state.updated',
      issue: ISSUE_NUMBER,
      observedAt: state.observedAt,
      intervalSeconds: INTERVAL_SECONDS,
      runInJob: run + 1,
      runsPerJob: RUNS_PER_JOB,
      symbols: SYMBOLS,
    }));
    if (run + 1 < RUNS_PER_JOB) await sleep(INTERVAL_SECONDS * 1000);
  }
} catch (error) {
  const failure = {
    status: 'degraded',
    mode: 'free-periodic-observer',
    observedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  try { await updateIssue(failure); } catch {}
  console.error(JSON.stringify(failure));
  process.exit(1);
}
