import { readdir, readFile, statfs } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type StorageVolumeSnapshot = {
  id: string;
  label: string;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  reservedBytes: number | null;
};

type FilesystemBlocks = { blocks: number; bfree: number; bavail: number; bsize: number };

export function calculateFilesystemUsage(stats: FilesystemBlocks) {
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const reservedBytes = Math.max(0, freeBytes - availableBytes);
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    reservedBytes,
    usedPercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0,
  };
}

/** Reads stats only for direct child paths that are mounted in the agent container. */
export async function collectMountedStorageVolumes(
  storageRoot = process.env.STORAGE_ROOT || "/host/storage",
  mountInfoText?: string,
): Promise<StorageVolumeSnapshot[]> {
  const root = resolve(storageRoot);
  const [entries, mounts] = await Promise.all([
    readdir(root, { withFileTypes: true }).catch(() => []),
    mountInfoText === undefined
      ? readFile("/proc/self/mountinfo", "utf8").catch(() => "")
      : Promise.resolve(mountInfoText),
  ]);
  const mountPoints = new Set(readMountPoints(mounts));
  const volumes: StorageVolumeSnapshot[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = resolve(root, entry.name);
    if (dirname(path) !== root || !mountPoints.has(path)) continue;

    const id = `disk:${entry.name}`;
    try {
      const stats = await statfs(path);
      const usage = calculateFilesystemUsage(stats);
      volumes.push({
        id,
        label: formatVolumeLabel(entry.name),
        totalBytes: usage.totalBytes,
        usedBytes: usage.usedBytes,
        availableBytes: usage.availableBytes,
        reservedBytes: usage.reservedBytes,
      });
    } catch {
      volumes.push({ id, label: formatVolumeLabel(entry.name), totalBytes: null, usedBytes: null, availableBytes: null, reservedBytes: null });
    }
  }

  return volumes.sort((left, right) => left.label.localeCompare(right.label));
}

function readMountPoints(mountInfoText: string): string[] {
  const mountPoints: string[] = [];
  for (const line of mountInfoText.split(/\r?\n/)) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const fields = line.slice(0, separator).split(" ");
    const mountPoint = fields[4];
    if (mountPoint) mountPoints.push(resolve(decodeMountField(mountPoint)));
  }
  return mountPoints;
}

function decodeMountField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function formatVolumeLabel(name: string): string {
  return basename(name)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (character) => character.toUpperCase()) || "Mounted disk";
}
