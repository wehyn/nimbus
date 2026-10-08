import { readFile, readlink, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NetworkRateSampler, type NetworkRateSnapshot } from "./network-metrics.ts";
import { collectMountedStorageVolumes, type StorageVolumeSnapshot } from "./storage-volumes.ts";

export type HardwareSnapshot = {
  temperatureC: number | null;
  powerWatts: number | null;
  powerSource: "intel-rapl" | null;
  networkRates?: NetworkRateSnapshot | null;
  storageVolumes?: StorageVolumeSnapshot[];
  updatedAt: string;
};

type HardwareClock = () => number;
type EnergySample = { microjoules: number; timestampMs: number };

const SAMPLE_INTERVAL_MS = 5_000;
const CPU_THERMAL_TYPES = ["x86_pkg_temp", "cpu", "CPU", "soc"];

export class HardwareSampler {
  private readonly sysRoot: string;
  private readonly storageRoot: string;
  private readonly networkSampler: NetworkRateSampler;
  private readonly now: HardwareClock;
  private previousEnergySample: EnergySample | undefined;
  private snapshot: HardwareSnapshot | undefined;
  private sampledAt = 0;
  private pendingRefresh: Promise<HardwareSnapshot> | undefined;

  constructor(
    sysRoot = process.env.SYS_ROOT || "/host/sys",
    now: HardwareClock = Date.now,
    procRoot = process.env.PROC_ROOT || "/host/proc",
    storageRoot = process.env.STORAGE_ROOT || "/host/storage",
  ) {
    this.sysRoot = sysRoot;
    this.storageRoot = storageRoot;
    this.now = now;
    this.networkSampler = new NetworkRateSampler(procRoot, now);
  }

  async getSnapshot(): Promise<HardwareSnapshot> {
    if (this.snapshot && this.now() - this.sampledAt < SAMPLE_INTERVAL_MS) return this.snapshot;
    return this.refresh();
  }

  async refresh(): Promise<HardwareSnapshot> {
    if (this.pendingRefresh) return this.pendingRefresh;

    this.pendingRefresh = this.readSnapshot().finally(() => {
      this.pendingRefresh = undefined;
    });
    return this.pendingRefresh;
  }

  private async readSnapshot(): Promise<HardwareSnapshot> {
    const timestampMs = this.now();
    const [temperatureC, energyMicrojoules, networkRates, storageVolumes] = await Promise.all([
      readCpuTemperature(this.sysRoot),
      readIntelPackageEnergy(this.sysRoot),
      this.networkSampler.sample(),
      collectMountedStorageVolumes(this.storageRoot),
    ]);

    const power = calculatePower(energyMicrojoules, this.previousEnergySample, timestampMs);
    if (energyMicrojoules !== null) {
      this.previousEnergySample = { microjoules: energyMicrojoules, timestampMs };
    }

    this.snapshot = {
      temperatureC,
      powerWatts: power,
      powerSource: energyMicrojoules === null ? null : "intel-rapl",
      networkRates,
      storageVolumes,
      updatedAt: new Date(timestampMs).toISOString(),
    };
    this.sampledAt = timestampMs;
    return this.snapshot;
  }
}

export async function readCpuTemperature(sysRoot = "/sys"): Promise<number | null> {
  const thermalRoot = join(sysRoot, "devices", "virtual", "thermal");
  const entries = await readdir(thermalRoot, { withFileTypes: true }).catch(() => []);
  const zones = entries
    .filter((entry) => entry.isDirectory() && /^thermal_zone\d+$/.test(entry.name))
    .sort((left, right) => Number(left.name.slice(12)) - Number(right.name.slice(12)));

  for (const zone of zones) {
    const type = (await readText(join(thermalRoot, zone.name, "type")))?.trim() || "";
    if (!CPU_THERMAL_TYPES.some((candidate) => type.startsWith(candidate))) continue;
    const temperature = parseTemperature(await readText(join(thermalRoot, zone.name, "temp")));
    if (temperature !== null) return temperature;
  }

  return readHwmonTemperature(sysRoot);
}

export async function readIntelPackageEnergy(sysRoot = "/sys"): Promise<number | null> {
  const powercapRoot = join(sysRoot, "class", "powercap");
  const raplRoot = await resolveSysfsEntry(sysRoot, powercapRoot, "intel-rapl");
  const entries = await readdir(raplRoot, { withFileTypes: true }).catch(() => []);
  const domains = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && /^intel-rapl:\d+$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

  for (const domain of domains) {
    const value = await readText(join(await resolveSysfsEntry(sysRoot, raplRoot, domain.name), "energy_uj"));
    const microjoules = parseEnergy(value);
    if (microjoules !== null) return microjoules;
  }

  const fallback = await readText(join(raplRoot, "intel-rapl:0", "energy_uj"));
  return parseEnergy(fallback);
}

export function calculatePower(
  currentMicrojoules: number | null,
  previous: EnergySample | undefined,
  timestampMs: number,
): number | null {
  if (currentMicrojoules === null || !previous) return null;
  const elapsedSeconds = (timestampMs - previous.timestampMs) / 1_000;
  const energyDelta = currentMicrojoules - previous.microjoules;
  if (elapsedSeconds <= 0 || energyDelta < 0) return null;
  return Number((energyDelta / 1_000_000 / elapsedSeconds).toFixed(2));
}

function parseTemperature(value: string | undefined): number | null {
  if (value === undefined) return null;
  const raw = Number(value.trim());
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw > 1_000 ? raw / 1_000 : raw);
}

async function readHwmonTemperature(sysRoot: string): Promise<number | null> {
  const hwmonRoot = join(sysRoot, "class", "hwmon");
  const entries = await readdir(hwmonRoot, { withFileTypes: true }).catch(() => []);
  const sensors = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && /^hwmon\d+$/.test(entry.name))
    .sort((left, right) => Number(left.name.slice(5)) - Number(right.name.slice(5)));
  for (const sensor of sensors) {
    const sensorPath = await resolveSysfsEntry(sysRoot, hwmonRoot, sensor.name);
    const sensorName = (await readText(join(sensorPath, "name")))?.trim() || "";
    const files = await readdir(sensorPath, { withFileTypes: true }).catch(() => []);
    const inputs = files
      .filter((entry) => entry.isFile() && /^temp\d+_input$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

    for (const input of inputs) {
      const temperature = parseTemperature(await readText(join(sensorPath, input.name)));
      if (temperature === null) continue;
      const labelName = input.name.replace(/_input$/, "_label");
      const label = (await readText(join(sensorPath, labelName)))?.trim() || "";
      if (isCpuSensor(`${sensorName} ${label}`)) return temperature;
    }
  }

  return null;
}

function isCpuSensor(value: string) {
  return /(?:x86_pkg_temp|coretemp|k10temp|zenpower|cpu(?:_thermal)?|package\s*id|soc)/i.test(value);
}

async function resolveSysfsEntry(sysRoot: string, parent: string, name: string) {
  const entryPath = join(parent, name);
  const link = await readTextLink(entryPath);
  if (!link) return entryPath;
  if (link.startsWith("/sys/")) return join(sysRoot, link.slice("/sys/".length));
  if (link.startsWith("/")) return join(sysRoot, link.slice(1));
  return resolve(parent, link);
}

async function readTextLink(path: string) {
  return readlink(path, "utf8").catch(() => undefined);
}

function parseEnergy(value: string | undefined) {
  if (value === undefined) return null;
  const microjoules = Number(value.trim());
  return Number.isFinite(microjoules) && microjoules >= 0 ? microjoules : null;
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}
