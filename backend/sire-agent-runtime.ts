/* Unified always-on SIRE runtime: HTTP agent gateway + durable background worker. */
import './sire-agent-gateway';
import { startAgentWorker } from '../workers/sire-agent-worker';

startAgentWorker().catch(error => {
  console.error('[SIRE agent runtime] worker stopped', error);
  process.exit(1);
});
