export const HISTORY_SAMPLE_INTERVAL_MS = 60_000;
export const HISTORY_RETENTION_DAYS = 30;
export const DEFAULT_HISTORY_MINUTES = 5;
export const MAX_HISTORY_MINUTES = 10_080;

export type HistoricalMetric = {
  timestamp: string;
  cpu: number;
  memory: number;
  storage: number;
  temperatureC: number | null;
  powerWatts: number | null;
};

export function normalizeHistoryMinutes(value: string | null | undefined) {
  if (value == null) return DEFAULT_HISTORY_MINUTES;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_MINUTES;
  return Math.min(MAX_HISTORY_MINUTES, Math.max(1, Math.floor(parsed)));
}

export function shouldRecordSnapshot(lastRecordedAt: number | undefined, now = Date.now()) {
  return lastRecordedAt === undefined || now - lastRecordedAt >= HISTORY_SAMPLE_INTERVAL_MS;
}
