  { id: 'high-low', label: 'High-Low' }, { id: 'line', label: 'Line' },
  { id: 'line-markers', label: 'Line + Markers' }, { id: 'step', label: 'Step Line' },
  { id: 'area', label: 'Area' }, { id: 'hlc-area', label: 'HLC Area' },
  { id: 'baseline', label: 'Baseline' }, { id: 'columns', label: 'Columns' }, { id: 'histogram', label: 'Histogram' },
] as const;
const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
const replaySpeedLabel = (speed: number) => `${speed}×`;

type DiagnosticLocation = { file: string; line: number; column: number; functionName?: string };
type ChartDiagnostic = DerivFeedDiagnostic & { id: number; timestamp: number; stack?: string; location?: DiagnosticLocation; operation?: string };

function parseDiagnosticLocation(stack?: string): DiagnosticLocation | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').map(line => line.trim()).filter(Boolean);
  for (const frame of lines) {
    const v8 = frame.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    const firefox = frame.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    const match = v8 || firefox;
    if (!match) continue;
    const functionName = v8 ? (v8[1] || '').trim() : (firefox ? (firefox[1] || '').trim() : '');
    const file = v8 ? v8[2] : firefox![2];
    const line = Number(v8 ? v8[3] : firefox![3]);
    const column = Number(v8 ? v8[4] : firefox![4]);
    if (file && Number.isFinite(line) && Number.isFinite(column)) return { file, line, column, functionName: functionName || undefined };
  }
  return undefined;
}

type SourceMapSegment = { generatedColumn: number; source?: number; originalLine?: number; originalColumn?: number; name?: number };

function decodeBase64Vlq(value: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = 0;
  let shift = 0;
  for (const char of value) {
    const digit = chars.indexOf(char);
    if (digit < 0) throw new Error('Invalid source-map VLQ digit.');
    const continuation = digit & 32;
    const payload = digit & 31;
    result += payload * 2 ** shift;
    shift += 5;
    if (!continuation) {
      const negative = result & 1;
      return negative ? -(result >> 1) : result >> 1;
    }
  }
  throw new Error('Incomplete source-map VLQ segment.');
}

function decodeSourceMapLine(encoded: string, previous: { source: number; originalLine: number; originalColumn: number; name: number }) {
  const segments: SourceMapSegment[] = [];
  let generatedColumn = 0;
  let source = previous.source;
  let originalLine = previous.originalLine;
  let originalColumn = previous.originalColumn;
  let name = previous.name;
  for (const rawSegment of encoded.split(',')) {
    if (!rawSegment) continue;
    const values: number[] = [];
    let token = '';
    for (const char of rawSegment) {
      token += char;
      try {
        const value = decodeBase64Vlq(token);
        values.push(value);
        token = '';
      } catch {}
    }
    if (token || values.length < 1) continue;
    generatedColumn += values[0];
    if (values.length >= 4) {
      source += values[1];
      originalLine += values[2];
      originalColumn += values[3];
      if (values.length >= 5) name += values[4];
      segments.push({ generatedColumn, source, originalLine, originalColumn, name });
    } else {
      segments.push({ generatedColumn });
    }
  }
  previous.source = source;
  previous.originalLine = originalLine;
  previous.originalColumn = originalColumn;
  previous.name = name;
  return segments;
}

async function resolveSourceMappedLocation(location?: DiagnosticLocation): Promise<DiagnosticLocation | undefined> {
  if (!location || typeof window === 'undefined') return location;
  if (!/\/assets\/[^/]+\\.js$/i.test(location.file)) return location;
  try {
    const bundleUrl = new URL(location.file, window.location.href);
    const mapUrl = new URL(bundleUrl.href + '.map');
    const response = await fetch(mapUrl.href, { credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) return location;
    const map = await response.json();
    if (map?.version !== 3 || typeof map.mappings !== 'string' || !Array.isArray(map.sources)) return location;

    const generatedLineIndex = Math.max(0, location.line - 1);
    const mappingLines = map.mappings.split(';');
    if (generatedLineIndex >= mappingLines.length) return location;

    const state = { source: 0, originalLine: 0, originalColumn: 0, name: 0 };
    let segments: SourceMapSegment[] = [];
    for (let index = 0; index <= generatedLineIndex; index++) {
      segments = decodeSourceMapLine(mappingLines[index] || '', state);
    }
    const targetColumn = Math.max(0, location.column - 1);
    const segment = [...segments].reverse().find(item => item.generatedColumn <= targetColumn && item.source !== undefined && item.originalLine !== undefined);
    if (!segment || segment.source === undefined || segment.originalLine === undefined || segment.originalColumn === undefined) return location;

    const rawSource = String(map.sources[segment.source] || '');
    const sourceRoot = String(map.sourceRoot || '');
    const sourceUrl = new URL(rawSource, new URL(sourceRoot || './', mapUrl.href));
    let file = sourceUrl.href;
    try {
      const mapPath = new URL(mapUrl.href).pathname;
      const sourcePath = new URL(sourceUrl.href).pathname;
      const marker = sourcePath.indexOf('/src/');
      file = marker >= 0 ? sourcePath.slice(marker + 1) : sourcePath;
    } catch {}
    return {
      file,
      line: segment.originalLine + 1,
      column: segment.originalColumn + 1,
      functionName: location.functionName,
    };
  } catch {
    return location;
  }
}

function diagnosticErrorDetails(error: unknown, operation?: string) {
  const stack = error instanceof Error ? error.stack : undefined;
  return { stack, location: parseDiagnosticLocation(stack), operation };
}

function analyzeChartHealth(events: ChartDiagnostic[], snapshot: { bars: number; tickAgeMs: number | null; width: number; height: number; hasCanvas: boolean; hasPrimarySeries: boolean }) {
  const latest = [...events].reverse();
  const find = (code: string) => latest.find(event => event.code === code);
  const runtime = find('CHART_FRONTEND_ERROR') || find('CHART_UNHANDLED_REJECTION');
  if (runtime) return { state: 'ISSUE', subsystem: 'Browser/runtime', cause: runtime.message, evidence: 'SIRE captured the browser exception directly.', next: 'Use the copied error/stack entry to locate the exact failing component or source line.' };
  if (find('CHART_ZERO_SIZE')) return { state: 'ISSUE', subsystem: 'Layout/DOM', cause: 'The chart container has no usable dimensions.', evidence: snapshot.width + '×' + snapshot.height + 'px was measured.', next: 'Fix the parent layout or visibility before debugging market data.' };
  if (!snapshot.hasCanvas) return { state: 'ISSUE', subsystem: 'Chart renderer', cause: 'No chart canvas is mounted.', evidence: 'The chart host contains no canvas element.', next: 'Inspect widget creation, renderer initialization and teardown.' };
  if (!snapshot.hasPrimarySeries) return { state: 'ISSUE', subsystem: 'OpenAlgo chart API', cause: 'The primary price series is unavailable through widget.chart.', evidence: 'SIRE could not obtain widget.chart.primarySeries().', next: 'Inspect the installed OpenAlgo Charts API/version and object shape.' };