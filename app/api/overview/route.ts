import os from "node:os";
import path from "node:path";
import { statfsSync } from "node:fs";
import { NextResponse } from "next/server";
import { HardwareSampler, type HardwareSnapshot } from "@/agent/hardware";
import { calculateFilesystemUsage } from "@/agent/storage-volumes";
import { recordMetricSnapshot } from "@/lib/db";
import { HISTORY_RETENTION_DAYS, shouldRecordSnapshot } from "@/lib/metrics-history";
import { createTtlCache } from "@/lib/ttl-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OVERVIEW_CACHE_TTL_MS = 2_000;
type CpuTimes = { idle: number; total: number };
let previousCpuTimes: CpuTimes | undefined;
let lastHistorySnapshotAt: number | undefined;
const localHardwareSampler = new HardwareSampler("/sys");
const overviewCache = createTtlCache<Overview>(OVERVIEW_CACHE_TTL_MS);

type Overview = {
  uptime: string;
  cpu: number;
  cpuCores: number;
  temperatureC: number | null;
  powerWatts: number | null;
  powerSource: "intel-rapl" | null;
  memory: number;
  memoryUsed: string;
  memoryTotal: string;
  storage: number;
  storageUsed: string;
  storageAvailable: string;
  storageTotal: string;
  downloadBytesPerSecond: number | null;
  uploadBytesPerSecond: number | null;
  storageVolumes: NonNullable<HardwareSnapshot["storageVolumes"]>;
  updatedAt: string;
};

export async function GET() {
  const overview = await overviewCache.get(sampleOverview);
  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Nimbus-Overview-Cache": "short-ttl-coalesced",
    },
  });
}

async function sampleOverview(): Promise<Overview> {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsed = totalMemory - freeMemory;
  const cpu = await getCpuUsage();
  const storage = getStorageUsage();
  const hardware = await getHardwareSnapshot();
  const updatedAt = new Date().toISOString();

  const overview: Overview = {
    uptime: formatUptime(os.uptime()),
    cpu,
    cpuCores: os.cpus().length,
    temperatureC: hardware.temperatureC,
    powerWatts: hardware.powerWatts,
    powerSource: hardware.powerSource,
    memory: roundPercent((memoryUsed / totalMemory) * 100),
    memoryUsed: formatBytes(memoryUsed),
    memoryTotal: formatBytes(totalMemory),
    storage: storage.usedPercent,
    storageUsed: formatBytes(storage.usedBytes),
    storageAvailable: formatBytes(storage.availableBytes),
    storageTotal: formatBytes(storage.totalBytes),
    downloadBytesPerSecond: hardware.networkRates?.receiveBytesPerSecond ?? null,
    uploadBytesPerSecond: hardware.networkRates?.transmitBytesPerSecond ?? null,
    storageVolumes: [
      {
        id: "nimbus",
        label: "Nimbus",
        reservedBytes: storage.reservedBytes,
        usedBytes: storage.usedBytes,
        availableBytes: storage.availableBytes,
        totalBytes: storage.totalBytes,
      },
      ...(hardware.storageVolumes ?? []).filter((volume) => volume.id !== "nimbus"),
    ],
    updatedAt,
  };
  const now = Date.now();
  if (shouldRecordSnapshot(lastHistorySnapshotAt, now)) {
    recordMetricSnapshot({ timestamp: updatedAt, cpu, memory: overview.memory, storage: overview.storage, temperatureC: hardware.temperatureC, powerWatts: hardware.powerWatts }, HISTORY_RETENTION_DAYS);
    lastHistorySnapshotAt = now;
  }
  return overview;
}

async function getHardwareSnapshot(): Promise<HardwareSnapshot> {
  const agentUrl = process.env.HARDWARE_AGENT_URL;
  if (agentUrl) {
    try {
      const response = await fetch(`${agentUrl.replace(/\/$/, "")}/v1/hardware`, {
        cache: "no-store",
        headers: process.env.MEMORY_AGENT_TOKEN ? { Authorization: `Bearer ${process.env.MEMORY_AGENT_TOKEN}` } : undefined,
        signal: AbortSignal.timeout(1_000),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok && isHardwareSnapshot(data)) return data;
    } catch {
      // Fall back to local sysfs when the optional agent is unavailable.
    }
  }

  return localHardwareSampler.getSnapshot();
}

function isHardwareSnapshot(value: unknown): value is HardwareSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<HardwareSnapshot>;
  return (snapshot.temperatureC === null || isFiniteNumber(snapshot.temperatureC))
    && (snapshot.powerWatts === null || (isFiniteNumber(snapshot.powerWatts) && snapshot.powerWatts >= 0))
    && (snapshot.powerSource === null || snapshot.powerSource === "intel-rapl")
    && (snapshot.networkRates === undefined || snapshot.networkRates === null || (
      isNonnegativeFinite(snapshot.networkRates.receiveBytesPerSecond)
      && isNonnegativeFinite(snapshot.networkRates.transmitBytesPerSecond)
    ))
    && (snapshot.storageVolumes === undefined || (
      Array.isArray(snapshot.storageVolumes)
      && snapshot.storageVolumes.every((volume) => Boolean(volume)
        && typeof volume.id === "string" && volume.id.length > 0 && volume.id.length <= 128
        && typeof volume.label === "string" && volume.label.length > 0 && volume.label.length <= 128
        && isNullableNonnegativeFinite(volume.totalBytes)
        && isNullableNonnegativeFinite(volume.usedBytes)
        && isNullableNonnegativeFinite(volume.availableBytes)
        && isNullableNonnegativeFinite(volume.reservedBytes))
    ))
    && typeof snapshot.updatedAt === "string" && snapshot.updatedAt.length > 0;
}

async function getCpuUsage() {
  const current = readCpuTimes();
  if (!previousCpuTimes) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const next = readCpuTimes();
  const baseline = previousCpuTimes || current;
  previousCpuTimes = next;

  const totalDelta = next.total - baseline.total;
  const idleDelta = next.idle - baseline.idle;
  if (totalDelta <= 0) return 0;
  return roundPercent(Math.min(100, Math.max(0, ((totalDelta - idleDelta) / totalDelta) * 100)));
}

function readCpuTimes(): CpuTimes {
  return os.cpus().reduce((totals, cpu) => ({
    idle: totals.idle + cpu.times.idle,
    total: totals.total + Object.values(cpu.times).reduce((sum, time) => sum + time, 0),
  }), { idle: 0, total: 0 });
}

function getStorageUsage() {
  const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "nimbus.db");
  let stats;
  try {
    stats = statfsSync(path.dirname(path.resolve(databasePath)));
  } catch {
    // The overview can race the first database request on a fresh local install.
    // Use the application filesystem until the database directory exists.
    stats = statfsSync(process.cwd());
  }
  return calculateFilesystemUsage(stats);
}

function roundPercent(value: number) {
  return Number(value.toFixed(2));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonnegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNullableNonnegativeFinite(value: unknown): value is number | null {
  return value === null || isNonnegativeFinite(value);
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}
