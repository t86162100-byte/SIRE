type IssueEvent = {
  id?: string; timestamp?: number; source?: string; level?: string; message?: string;
  detail?: string; stack?: string; url?: string; line?: number; column?: number;
  file?: string; component?: string; cause?: string; traceId?: string;
};
const recent: IssueEvent[] = [];
const MAX = 500;
const clean = (value: unknown, max=8000) => String(value ?? '').replace(/(Bearer\s+)[^\s]+/ig,'$1[redacted]').slice(0,max);
export function recordIssue(input: IssueEvent) {
  const item: IssueEvent = {
    id: clean(input.id || `issue-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,120),
    timestamp: Number(input.timestamp || Date.now()),
    source: clean(input.source || 'browser',120), level: clean(input.level || 'error',30),
    message: clean(input.message || 'Unknown issue',1000), detail: clean(input.detail,4000)||undefined,
    stack: clean(input.stack,12000)||undefined, url: clean(input.url,2000)||undefined,
    line: Number.isFinite(Number(input.line)) ? Number(input.line) : undefined,
    column: Number.isFinite(Number(input.column)) ? Number(input.column) : undefined,
    file: clean(input.file,500)||undefined, component: clean(input.component,300)||undefined,
    cause: clean(input.cause,2000)||undefined, traceId: clean(input.traceId,200)||undefined,
  };
  recent.unshift(item); recent.splice(MAX); return item;
}
export function getRecentIssues(){ return recent.map(item=>({...item})); }
