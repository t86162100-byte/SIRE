type RunTiming = {
  id: string;
  startedAt: string;
  totalMs: number;
  stages: Record<string, number>;
  slowestStage: string | null;
  slowestMs: number;
  mode?: string;
  queryType?: string;
  ok: boolean;
  error?: string;
};

const recent: RunTiming[] = [];
const MAX = 50;

export function recordAiRun(run: Omit<RunTiming, 'id'>) {
  const item: RunTiming = { ...run, id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  recent.unshift(item);
  recent.splice(MAX);
  return item;
}

export function getAiMonitor() {
  const runs = recent.map(item => ({ ...item, stages: { ...item.stages } }));
  const last = runs[0] || null;
  const completed = runs.filter(item => item.ok);
  const failed = runs.filter(item => !item.ok);
  const averageMs = completed.length ? Math.round(completed.reduce((sum, item) => sum + item.totalMs, 0) / completed.length) : 0;
  const slowest = runs.reduce<RunTiming | null>((winner, item) => !winner || item.totalMs > winner.totalMs ? item : winner, null);
  return {
    recentRuns: runs.slice(0, 20),
    lastRun: last,
    counts: { tracked: runs.length, completed: completed.length, failed: failed.length },
    averageMs,
    slowestRunMs: slowest?.totalMs || 0,
    thresholds: { noticeMs: 3000, slowMs: 8000, criticalMs: 15000 },
  };
}
