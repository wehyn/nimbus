import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type NetworkRateSnapshot = {
  receiveBytesPerSecond: number;
  transmitBytesPerSecond: number;
};

type NetworkCounters = { receiveBytes: string; transmitBytes: string };
type NetworkSample = {
  interfaces: string[];
  counters: Map<string, NetworkCounters>;
  timestampMs: number;
};
type NetworkClock = () => number;

/** Samples traffic on interfaces in the host's lowest-metric IPv4 default route. */
export class NetworkRateSampler {
  private readonly procRoot: string;
  private readonly now: NetworkClock;
  private previous: NetworkSample | undefined;

  constructor(procRoot = "/proc", now: NetworkClock = Date.now) {
    this.procRoot = procRoot;
    this.now = now;
  }

  async sample(): Promise<NetworkRateSnapshot | null> {
    const [routeText, deviceText] = await Promise.all([
      readText(join(this.procRoot, "1", "net", "route")),
      readText(join(this.procRoot, "1", "net", "dev")),
    ]);
    const interfaces = routeText === undefined ? [] : selectDefaultRouteInterfaces(routeText);
    const counters = deviceText === undefined ? null : parseDeviceCounters(deviceText);
    const timestampMs = this.now();

    if (interfaces.length === 0 || counters === null || interfaces.some((name) => !counters.has(name))) {
      this.previous = undefined;
      return null;
    }

    const current: NetworkSample = {
      interfaces,
      counters,
      timestampMs,
    };
    const previous = this.previous;
    this.previous = current;
    if (!previous || !sameInterfaces(previous.interfaces, interfaces)) return null;

    const elapsedMs = timestampMs - previous.timestampMs;
    if (elapsedMs <= 0) return null;

    let receiveDelta = 0;
    let transmitDelta = 0;
    for (const name of interfaces) {
      const before = previous.counters.get(name);
      const after = counters.get(name);
      if (!before || !after) return null;
      const interfaceReceiveDelta = subtractCounters(after.receiveBytes, before.receiveBytes);
      const interfaceTransmitDelta = subtractCounters(after.transmitBytes, before.transmitBytes);
      if (interfaceReceiveDelta === null || interfaceTransmitDelta === null) return null;
      receiveDelta += interfaceReceiveDelta;
      transmitDelta += interfaceTransmitDelta;
    }

    const seconds = elapsedMs / 1_000;
    return {
      receiveBytesPerSecond: Number(receiveDelta) / seconds,
      transmitBytesPerSecond: Number(transmitDelta) / seconds,
    };
  }
}

function selectDefaultRouteInterfaces(routeText: string): string[] {
  let lowestMetric: number | undefined;
  const selected = new Set<string>();
  for (const line of routeText.split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 8 || fields[1] !== "00000000" || fields[7] !== "00000000") continue;
    const flags = Number.parseInt(fields[3], 16);
    const metric = Number.parseInt(fields[6], 16);
    if (!fields[0] || fields[0] === "lo" || !Number.isFinite(flags) || !(flags & 0x1) || !Number.isSafeInteger(metric) || metric < 0) continue;

    if (lowestMetric === undefined || metric < lowestMetric) {
      lowestMetric = metric;
      selected.clear();
    }
    if (metric === lowestMetric) selected.add(fields[0]);
  }
  return [...selected].sort();
}

function parseDeviceCounters(deviceText: string): Map<string, NetworkCounters> {
  const counters = new Map<string, NetworkCounters>();
  for (const line of deviceText.split(/\r?\n/).slice(2)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const fields = line.slice(separator + 1).trim().split(/\s+/);
    if (!name || fields.length < 9) continue;
    try {
      const receiveBytes = fields[0];
      const transmitBytes = fields[8];
      if (!/^\d+$/.test(receiveBytes) || !/^\d+$/.test(transmitBytes)) continue;
      counters.set(name, { receiveBytes, transmitBytes });
    } catch {
      // Ignore malformed device rows; a required route interface will then be unavailable.
    }
  }
  return counters;
}

function subtractCounters(after: string, before: string): number | null {
  const left = after.replace(/^0+(?=\d)/, "");
  const right = before.replace(/^0+(?=\d)/, "");
  if (left.length < right.length || (left.length === right.length && left < right)) return null;

  let borrow = 0;
  let difference = "";
  const rightOffset = left.length - right.length;
  for (let index = left.length - 1; index >= 0; index -= 1) {
    const rightIndex = index - rightOffset;
    let digit = Number(left[index]) - borrow - Number(right[rightIndex] ?? "0");
    borrow = digit < 0 ? 1 : 0;
    if (borrow) digit += 10;
    difference = `${digit}${difference}`;
  }

  const delta = Number(difference);
  return Number.isFinite(delta) ? delta : null;
}

function sameInterfaces(left: string[], right: string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}
