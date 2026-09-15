/* Long-running SIRE autonomous worker.
 * Render runs this as a background worker. It polls the durable SIRE job table,
 * checkpoints failures, and can resume continuous tasks after restarts/deploys.
 */
import { db } from '@appdeploy/sdk';

const JOB_TABLE = 'sire_agent_jobs_v1';
const POLL_MS = Math.max(1000, Number(process.env.SIRE_AGENT_POLL_MS || 5000));
const LEASE_MS = Math.max(30000, Number(process.env.SIRE_AGENT_LEASE_MS || 120000));
const EXECUTOR_URL = process.env.SIRE_AGENT_EXECUTOR_URL;
let stopping = false;

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function execute(job: Record<string, unknown>) {
  if (!EXECUTOR_URL) throw new Error('SIRE_AGENT_EXECUTOR_URL is not configured');
  const response = await fetch(EXECUTOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.SIRE_AGENT_EXECUTOR_TOKEN ? { authorization: `Bearer ${process.env.SIRE_AGENT_EXECUTOR_TOKEN}` } : {}) },
    body: JSON.stringify({ job }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Executor HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return { output: text }; }
}

async function claimOne() {
  const now = Date.now();
  const rows = await db.list<Record<string, unknown>>(JOB_TABLE, { limit: 100 });
  const candidates = rows.items
    .filter(x => x.status === 'queued' || (x.status === 'running' && Number(x.leaseUntil || 0) < now))
    .filter(x => Number(x.nextRunAt || 0) <= now)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const job = candidates[0];
  if (!job?.id) return false;
  const claimed = { ...job, status: 'running', leaseUntil: now + LEASE_MS, updatedAt: now, attempts: Number(job.attempts || 0) + 1 };
  await db.update(JOB_TABLE, [{ id: job.id, record: claimed }]);
  try {
    const result = await execute(claimed);
    const completed = { ...claimed, status: claimed.continuous ? 'running' : 'completed', leaseUntil: null, updatedAt: Date.now(), lastResult: result, lastError: null, nextRunAt: claimed.continuous ? Date.now() + POLL_MS : null };
    await db.update(JOB_TABLE, [{ id: job.id, record: completed }]);
  } catch (error) {
    const attempts = Number(claimed.attempts || 1);
    const delay = Math.min(300000, Math.max(5000, 1000 * 2 ** Math.min(attempts, 8)));
    await db.update(JOB_TABLE, [{ id: job.id, record: { ...claimed, status: 'queued', leaseUntil: null, updatedAt: Date.now(), nextRunAt: Date.now() + delay, lastError: error instanceof Error ? error.message : String(error) } }]);
  }
  return true;
}

async function main() {
  console.log('[SIRE agent worker] started');
  if (!EXECUTOR_URL) console.warn('[SIRE agent worker] SIRE_AGENT_EXECUTOR_URL is missing; jobs will remain queued until configured.');
  while (!stopping) {
    try { await claimOne(); } catch (error) { console.error('[SIRE agent worker] loop error', error); }
    await sleep(POLL_MS);
  }
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
main().catch(error => { console.error(error); process.exit(1); });
