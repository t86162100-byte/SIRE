import { db } from '@appdeploy/sdk';

type StoredBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Chunk = {
  chunkKey: string;
  symbol: string;
  interval: string;
  oldest: number;
  newest: number;
  bars: StoredBar[];
  updatedAt: string;
};

const CHUNK_BARS = 2000;
const TABLE_PREFIX = 'sire_deriv_history_v1_';

function tableName(symbol: string, interval: string) {
  const cleanSymbol = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 32);
  const cleanInterval = String(interval).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 12);
  return `${TABLE_PREFIX}${cleanSymbol}_${cleanInterval}`;
}

function intervalSeconds(interval: string) {
  const match = String(interval).match(/^(\\d+)([mhdw])$/i);
  if (!match) return 60;
  const n = Math.max(1, Number(match[1]));
  const unit = match[2].toLowerCase();
  return unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : unit === 'd' ? n * 86400 : n * 604800;
}

function chunkKey(time: number, interval: string) {
  const span = intervalSeconds(interval) * CHUNK_BARS;
  return String(Math.floor(time / span));
}

function validBar(value: any): StoredBar | null {
  const time = Number(value?.time ?? value?.epoch);
  const open = Number(value?.open);
  const high = Number(value?.high);
  const low = Number(value?.low);
  const close = Number(value?.close);
  const volume = Number(value?.volume);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, ...(Number.isFinite(volume) ? { volume } : {}) };
}

function mergeBars(...groups: StoredBar[][]) {
  const byTime = new Map<number, StoredBar>();
  for (const group of groups) {
    for (const raw of group) {
      const bar = validBar(raw);
      if (bar) byTime.set(bar.time, bar);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function listChunks(symbol: string, interval: string): Promise<Array<Chunk & { id: string }>> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const result = await db.list<any>(tableName(symbol, interval), { limit: 1000 });
    return result.items
      .map((item: any) => ({ ...item, bars: Array.isArray(item?.bars) ? item.bars.map(validBar).filter(Boolean) : [] }))
      .filter((item: any) => item.chunkKey && item.bars.length);
  } catch (error) {
    console.warn('[DERIV HISTORY STORE] read failed:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

export async function persistHistoryBars(symbol: string, interval: string, inputBars: StoredBar[]) {
  if (!process.env.DATABASE_URL || !inputBars.length) return { enabled: Boolean(process.env.DATABASE_URL), stored: 0, chunks: 0 };
  const bars = mergeBars(inputBars);
  if (!bars.length) return { enabled: true, stored: 0, chunks: 0 };

  try {
    const table = tableName(symbol, interval);
    const existing = await listChunks(symbol, interval);
    const byKey = new Map(existing.map(item => [item.chunkKey, item]));
    const grouped = new Map<string, StoredBar[]>();

    for (const bar of bars) {
      const key = chunkKey(bar.time, interval);
      const list = grouped.get(key) || [];
      list.push(bar);
      grouped.set(key, list);
    }

    let stored = 0;
    let chunks = 0;
    for (const [key, incoming] of grouped) {
      const previous = byKey.get(key);
      const merged = mergeBars(previous?.bars || [], incoming);
      const record: Chunk = {
        chunkKey: key,
        symbol: String(symbol).toUpperCase(),
        interval,
        oldest: merged[0]?.time ?? 0,
        newest: merged[merged.length - 1]?.time ?? 0,
        bars: merged,
        updatedAt: new Date().toISOString(),
      };
      if (previous?.id) {
        await db.update(table, [{ id: previous.id, record }]);
      } else {
        await db.add(table, [record]);
      }
      stored += incoming.length;
      chunks += 1;
    }
    return { enabled: true, stored, chunks };
  } catch (error) {
    console.warn('[DERIV HISTORY STORE] write failed:', error instanceof Error ? error.message : String(error));
    return { enabled: true, stored: 0, chunks: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getStoredHistory(
  symbol: string,
  interval: string,
  end: number | 'latest' = 'latest',
  count = 500,
) {
  if (!process.env.DATABASE_URL) return { enabled: false, bars: [] as StoredBar[], chunks: 0 };
  const chunks = await listChunks(symbol, interval);
  const latestEnd = end === 'latest' ? Number.POSITIVE_INFINITY : Number(end);
  const bars = mergeBars(...chunks.map(chunk => chunk.bars))
    .filter(bar => bar.time <= latestEnd)
    .slice(-Math.max(1, Math.floor(count)));
  return { enabled: true, bars, chunks: chunks.length };
}

export async function historyStoreStatus() {
  return {
    enabled: Boolean(process.env.DATABASE_URL),
    tablePrefix: TABLE_PREFIX,
    chunkBars: CHUNK_BARS,
  };
}
