import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { open, opendir } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDockerSnapshot } from "./docker-discovery.ts";
import { HardwareSampler } from "./hardware.js";

type ProcessRecord = {
  pid: number;
  name: string;
  command: string;
  user: string;
  rssBytes: number;
  memoryPercent: number;
};

type CpuProcessRecord = ProcessRecord & {
  cpuPercent: number;
};

type PolicyOmittedReason = "process-limit" | "scan-limit" | "scan-and-process-limit" | null;

export type MemorySnapshot = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  processes: ProcessRecord[];
  totalCount: number;
  returnedCount: number;
  unreadableCount: number;
  policyOmittedCount: number;
  policyOmittedReason: PolicyOmittedReason;
  partial: boolean;
  /** Compatibility alias for clients that still read the old unreadable count. */
  omittedCount: number;
  warnings: string[];
  updatedAt: string;
};

export type ProcessorSnapshot = {
  cpuPercent: number;
  cpuCores: number;
  loadAverage: {
    one: number;
    five: number;
    fifteen: number;
  };
  processes: CpuProcessRecord[];
  totalCount: number;
  returnedCount: number;
  unreadableCount: number;
  policyOmittedCount: number;
  policyOmittedReason: PolicyOmittedReason;
  sampling: boolean;
  partial: boolean;
  /** Compatibility alias for clients that still read the old unreadable count. */
  omittedCount: number;
  warnings: string[];
  updatedAt: string;
};

type ProcessRoots = {
  procRoot?: string;
  passwdPath?: string;
  signal?: AbortSignal;
};

type ProcessDetails = {
  name: string;
  uid: number;
  rssBytes: number;
  command: string;
};

type ProcessList = {
  ids: number[];
  totalCount: number;
  scanOmittedCount: number;
};

type CpuSample = {
  totalTicks: number;
  idleTicks: number;
  cpuCores: number;
  loadAverage: { one: number; five: number; fifteen: number };
  processTicks: Map<number, number>;
  processIds: number[];
  totalCount: number;
  scanOmittedCount: number;
  omittedCount: number;
  warnings: string[];
};

const procRoot = process.env.PROC_ROOT || "/host/proc";
const passwdPath = process.env.PASSWD_PATH || "/host/etc/passwd";
const port = Number(process.env.AGENT_PORT || 8787);
const sharedToken = process.env.MEMORY_AGENT_TOKEN || "";
const dockerToken = process.env.DOCKER_AGENT_TOKEN || sharedToken;
const previousCpuSamples = new Map<string, CpuSample>();
const hardwareSampler = new HardwareSampler();

const PROCESS_READ_CONCURRENCY = 32;
const PROCESS_SCAN_LIMIT = 1_024;
const PROCESS_RESPONSE_LIMIT = 256;
const MAX_PROCESS_COMMAND_LENGTH = 180;
const MAX_PROCESS_STRING_LENGTH = 180;
const MAX_PROCESS_WARNINGS = 32;
const MAX_PROCESS_WARNING_LENGTH = 180;
const MAX_STATUS_BYTES = 16 * 1024;
const MAX_COMMAND_BYTES = 4 * 1024;
const MAX_PASSWD_BYTES = 256 * 1024;
const MAX_PROCESS_RESPONSE_BYTES = 512 * 1024;

export async function collectSnapshot(roots: ProcessRoots = {}): Promise<MemorySnapshot> {
  const currentProcRoot = roots.procRoot || procRoot;
  const currentPasswdPath = roots.passwdPath || passwdPath;
  const signal = roots.signal;
  throwIfAborted(signal);

  const warnings: string[] = [];
  const memory = await readMemory(currentProcRoot, signal);
  const users = await readUsers(currentPasswdPath, warnings, signal);
  const processes: ProcessRecord[] = [];
  let unreadableCount = 0;
  const processList = await listProcessIds(currentProcRoot, signal);

  const results = await mapWithConcurrency(processList.ids, PROCESS_READ_CONCURRENCY, async (pid) => {
    throwIfAborted(signal);
    try {
      return await readProcess(currentProcRoot, pid, users, memory.totalBytes, undefined, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  }, signal);

  for (const result of results) {
    if (result) processes.push(result as ProcessRecord);
    else unreadableCount += 1;
  }

  processes.sort((left, right) => right.rssBytes - left.rssBytes || left.name.localeCompare(right.name) || left.pid - right.pid);
  const responseOmittedCount = Math.max(0, processes.length - PROCESS_RESPONSE_LIMIT);
  const policyOmittedCount = processList.scanOmittedCount + responseOmittedCount;
  if (unreadableCount) warnings.push(`${unreadableCount} process${unreadableCount === 1 ? " was" : "es were"} unavailable while scanning.`);
  if (processList.scanOmittedCount) warnings.push(`${processList.scanOmittedCount} process${processList.scanOmittedCount === 1 ? " was" : "es were"} omitted by the scan limit.`);
  if (responseOmittedCount) warnings.push(`${responseOmittedCount} process${responseOmittedCount === 1 ? " was" : "es were"} omitted by the process limit.`);

  return {
    ...memory,
    processes: processes.slice(0, PROCESS_RESPONSE_LIMIT),
    totalCount: processList.totalCount,
    returnedCount: Math.min(processes.length, PROCESS_RESPONSE_LIMIT),
    unreadableCount,
    policyOmittedCount,
    policyOmittedReason: getPolicyOmittedReason(processList.scanOmittedCount, responseOmittedCount),
    partial: unreadableCount > 0 || policyOmittedCount > 0 || warnings.length > 0,
    omittedCount: unreadableCount,
    warnings: normalizeWarnings(warnings),
    updatedAt: new Date().toISOString(),
  };
}

export async function collectProcessorSnapshot(roots: ProcessRoots = {}): Promise<ProcessorSnapshot> {
  const currentProcRoot = roots.procRoot || procRoot;
  const currentPasswdPath = roots.passwdPath || passwdPath;
  const signal = roots.signal;
  throwIfAborted(signal);

  const firstSample = await readCpuSample(currentProcRoot, signal);
  const memory = await readMemory(currentProcRoot, signal);
  const baseline = previousCpuSamples.get(currentProcRoot);
  let currentSample = firstSample;
  const sampling = !baseline;

  if (!baseline) {
    await delay(100, signal);
    currentSample = await readCpuSample(currentProcRoot, signal);
  }

  previousCpuSamples.set(currentProcRoot, currentSample);
  const warnings = [...currentSample.warnings];
  let unreadableCount = currentSample.omittedCount;
  const totalDelta = currentSample.totalTicks - (baseline?.totalTicks || firstSample.totalTicks);
  const idleDelta = currentSample.idleTicks - (baseline?.idleTicks || firstSample.idleTicks);
  const cpuPercent = calculateCpuPercent(totalDelta, idleDelta);
  const users = await readUsers(currentPasswdPath, warnings, signal);
  const processes: CpuProcessRecord[] = [];

  const results = await mapWithConcurrency(currentSample.processIds, PROCESS_READ_CONCURRENCY, async (pid) => {
    throwIfAborted(signal);
    try {
      const processTicks = currentSample.processTicks.get(pid) || 0;
      const baselineTicks = baseline?.processTicks.get(pid) || firstSample.processTicks.get(pid) || processTicks;
      const processDelta = Math.max(0, processTicks - baselineTicks);
      const processCpuPercent = calculateProcessCpuPercent(processDelta, totalDelta);
      return await readProcess(currentProcRoot, pid, users, memory.totalBytes, processCpuPercent, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  }, signal);

  for (const result of results) {
    if (result) processes.push(result as CpuProcessRecord);
    else unreadableCount += 1;
  }

  processes.sort((left, right) => right.cpuPercent - left.cpuPercent || left.name.localeCompare(right.name) || left.pid - right.pid);
  const responseOmittedCount = Math.max(0, processes.length - PROCESS_RESPONSE_LIMIT);
  const policyOmittedCount = currentSample.scanOmittedCount + responseOmittedCount;
  if (unreadableCount) warnings.push(`${unreadableCount} process${unreadableCount === 1 ? " was" : "es were"} unavailable while scanning.`);
  if (currentSample.scanOmittedCount) warnings.push(`${currentSample.scanOmittedCount} process${currentSample.scanOmittedCount === 1 ? " was" : "es were"} omitted by the scan limit.`);
  if (responseOmittedCount) warnings.push(`${responseOmittedCount} process${responseOmittedCount === 1 ? " was" : "es were"} omitted by the process limit.`);

  return {
    cpuPercent,
    cpuCores: currentSample.cpuCores,
    loadAverage: currentSample.loadAverage,
    processes: processes.slice(0, PROCESS_RESPONSE_LIMIT),
    totalCount: currentSample.totalCount,
    returnedCount: Math.min(processes.length, PROCESS_RESPONSE_LIMIT),
    unreadableCount,
    policyOmittedCount,
    policyOmittedReason: getPolicyOmittedReason(currentSample.scanOmittedCount, responseOmittedCount),
    sampling,
    partial: unreadableCount > 0 || policyOmittedCount > 0 || warnings.length > 0,
    omittedCount: unreadableCount,
    warnings: normalizeWarnings(warnings),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeCommand(rawCommand: string, fallbackName: string): string {
  const args = rawCommand.slice(0, MAX_COMMAND_BYTES).split("\0").filter(Boolean);
  if (!args.length) return limitString(fallbackName, MAX_PROCESS_COMMAND_LENGTH);

  const sanitized: string[] = [];
  let redactNext = false;
  for (const [index, rawArg] of args.entries()) {
    const arg = limitString(rawArg, MAX_PROCESS_STRING_LENGTH);
    if (redactNext) {
      sanitized.push("<redacted>");
      redactNext = false;
      continue;
    }

    if (/^-p(?:ort|rofile|id)(?:=|$)/.test(arg)) {
      sanitized.push(arg);
      continue;
    }

    if (/^-p.+/.test(arg)) {
      sanitized.push("-p<redacted>");
      continue;
    }

    const keyMatch = /^--?(?:[a-z0-9]+[-_])*(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|auth|credential)(?:=|$)/i.test(arg);
    if (keyMatch) {
      sanitized.push(arg.includes("=") ? `${arg.slice(0, arg.indexOf("=") + 1)}<redacted>` : `${arg}=<redacted>`);
      if (!arg.includes("=")) redactNext = true;
      continue;
    }

    sanitized.push(index === 0 ? basename(arg) : arg);
  }

  const command = sanitized.join(" ").trim();
  return command.length > MAX_PROCESS_COMMAND_LENGTH ? `${command.slice(0, MAX_PROCESS_COMMAND_LENGTH - 3)}...` : command || limitString(fallbackName, MAX_PROCESS_COMMAND_LENGTH);
}

async function listProcessIds(currentProcRoot: string, signal?: AbortSignal): Promise<ProcessList> {
  throwIfAborted(signal);
  let directory;
  try {
    directory = await opendir(currentProcRoot);
  } catch {
    throw new Error(`Unable to read process directory: ${currentProcRoot}`);
  }

  const ids: number[] = [];
  let totalCount = 0;
  let scanOmittedCount = 0;
  try {
    for await (const entry of directory) {
      throwIfAborted(signal);
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      if (!Number.isSafeInteger(pid) || pid < 0) continue;
      if (ids.length < PROCESS_SCAN_LIMIT) ids.push(pid);
      else scanOmittedCount += 1;
    }
  } finally {
    await directory.close().catch(() => undefined);
  }

  ids.sort((left, right) => left - right);
  totalCount = ids.length + scanOmittedCount;
  return { ids, totalCount, scanOmittedCount };
}

async function readCpuSample(currentProcRoot: string, signal?: AbortSignal): Promise<CpuSample> {
  const [stat, loadAverage, processList] = await Promise.all([
    readTextLimited(`${currentProcRoot}/stat`, MAX_STATUS_BYTES, signal),
    readTextLimited(`${currentProcRoot}/loadavg`, MAX_STATUS_BYTES, signal),
    listProcessIds(currentProcRoot, signal),
  ]);
  const cpuLine = stat.split("\n").find((line) => line.startsWith("cpu "));
  if (!cpuLine) throw new Error("Unable to read aggregate CPU statistics.");

  const cpuValues = cpuLine.trim().split(/\s+/).slice(1, 9).map(Number);
  const totalTicks = cpuValues.reduce((sum, value) => sum + value, 0);
  const idleTicks = (cpuValues[3] || 0) + (cpuValues[4] || 0);
  const cpuCores = stat.split("\n").filter((line) => /^cpu\d+\s/.test(line)).length;
  const loadValues = loadAverage.trim().split(/\s+/).slice(0, 3).map(Number);
  const processResults = await mapWithConcurrency(processList.ids, PROCESS_READ_CONCURRENCY, async (pid) => {
    throwIfAborted(signal);
    try {
      return { pid, ticks: parseProcessTicks(await readTextLimited(`${currentProcRoot}/${pid}/stat`, MAX_STATUS_BYTES, signal)) };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  }, signal);
  const processTicks = new Map<number, number>();
  for (const result of processResults) {
    if (result) processTicks.set(result.pid, result.ticks);
  }
  const omittedCount = processResults.length - processTicks.size;
  return {
    totalTicks,
    idleTicks,
    cpuCores: cpuCores || 1,
    loadAverage: { one: loadValues[0] || 0, five: loadValues[1] || 0, fifteen: loadValues[2] || 0 },
    processTicks,
    processIds: [...processTicks.keys()],
    totalCount: processList.totalCount,
    scanOmittedCount: processList.scanOmittedCount,
    omittedCount,
    warnings: omittedCount ? [`${omittedCount} process${omittedCount === 1 ? " was" : "es were"} unavailable while sampling CPU.`] : [],
  };
}

function parseProcessTicks(stat: string) {
  const closingParen = stat.lastIndexOf(")");
  if (closingParen < 0) throw new Error("Invalid process statistics.");
  const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) throw new Error("Invalid process CPU statistics.");
  return userTicks + systemTicks;
}

export function calculateCpuPercent(totalDelta: number, idleDelta: number) {
  return Number.isFinite(totalDelta) && Number.isFinite(idleDelta) && totalDelta > 0
    ? toPercent(((totalDelta - idleDelta) / totalDelta) * 100)
    : 0;
}

export function calculateProcessCpuPercent(processDelta: number, totalDelta: number) {
  return Number.isFinite(processDelta) && Number.isFinite(totalDelta) && totalDelta > 0
    ? toPercent((Math.max(0, processDelta) / totalDelta) * 100)
    : 0;
}

async function readMemory(currentProcRoot: string, signal?: AbortSignal) {
  const meminfo = await readTextLimited(`${currentProcRoot}/meminfo`, MAX_STATUS_BYTES, signal);
  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }

  const totalBytes = values.get("MemTotal") || 0;
  const availableBytes = values.get("MemAvailable") || values.get("MemFree") || 0;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent: totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0,
  };
}

async function readUsers(currentPasswdPath: string, warnings: string[], signal?: AbortSignal) {
  const users = new Map<number, string>();
  try {
    const passwd = await readTextLimited(currentPasswdPath, MAX_PASSWD_BYTES, signal);
    for (const line of passwd.split("\n")) {
      const fields = line.split(":");
      const uid = Number(fields[2]);
      if (fields[0] && Number.isFinite(uid)) users.set(uid, limitString(fields[0], MAX_PROCESS_STRING_LENGTH));
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    warnings.push("Host user names are unavailable; process owners are shown as UIDs.");
  }
  return users;
}

async function readProcess(
  currentProcRoot: string,
  pid: number,
  users: Map<number, string>,
  totalBytes: number,
  cpuPercent?: number,
  signal?: AbortSignal,
): Promise<ProcessRecord | CpuProcessRecord> {
  throwIfAborted(signal);
  const status = await readTextLimited(`${currentProcRoot}/${pid}/status`, MAX_STATUS_BYTES, signal);
  const name = limitString(readStatusValue(status, "Name") || `PID ${pid}`, MAX_PROCESS_STRING_LENGTH);
  const parsedUid = Number((readStatusValue(status, "Uid") || "").split(/\s+/)[0]);
  const uid = Number.isInteger(parsedUid) && parsedUid >= 0 ? parsedUid : -1;
  const parsedRssKb = Number((readStatusValue(status, "VmRSS") || "0").split(/\s+/)[0]);
  const rssKb = Number.isFinite(parsedRssKb) && parsedRssKb >= 0 ? parsedRssKb : 0;
  const command = await readTextLimited(`${currentProcRoot}/${pid}/cmdline`, MAX_COMMAND_BYTES, signal).catch((error) => {
    if (isAbortError(error)) throw error;
    return "";
  });
  const details: ProcessDetails = { name, uid, rssBytes: Math.max(0, rssKb) * 1024, command };
  return {
    pid,
    name: details.name,
    command: sanitizeCommand(details.command, details.name),
    user: limitString(users.get(details.uid) || `uid:${details.uid}`, MAX_PROCESS_STRING_LENGTH),
    rssBytes: details.rssBytes,
    memoryPercent: totalBytes ? Number(((details.rssBytes / totalBytes) * 100).toFixed(2)) : 0,
    ...(cpuPercent !== undefined ? { cpuPercent } : {}),
  } as ProcessRecord | CpuProcessRecord;
}

function readStatusValue(status: string, key: string) {
  const line = status.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim() || "";
}

function toPercent(value: number) {
  const bounded = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return Number(bounded.toFixed(2));
}

function getPolicyOmittedReason(scanOmittedCount: number, responseOmittedCount: number): PolicyOmittedReason {
  if (scanOmittedCount > 0 && responseOmittedCount > 0) return "scan-and-process-limit";
  if (scanOmittedCount > 0) return "scan-limit";
  if (responseOmittedCount > 0) return "process-limit";
  return null;
}

function normalizeWarnings(warnings: string[]) {
  return [...new Set(warnings)]
    .map((warning) => limitString(warning, MAX_PROCESS_WARNING_LENGTH))
    .slice(0, MAX_PROCESS_WARNINGS);
}

function limitString(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

async function readTextLimited(filePath: string, maxBytes: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    throwIfAborted(signal);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  if (!items.length) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError() {
  const error = new Error("Process collection was canceled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isAuthorized(request: IncomingMessage, pathname: string) {
  const token = pathname === "/v1/docker/containers" ? dockerToken : sharedToken;
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function sendJson(response: ServerResponse, status: number, body: unknown, bounded = false) {
  let payload = JSON.stringify(body);
  let responseStatus = status;
  if (bounded && Buffer.byteLength(payload, "utf8") > MAX_PROCESS_RESPONSE_BYTES) {
    payload = JSON.stringify({ error: "The process metrics response exceeded its size limit." });
    responseStatus = 500;
  }
  response.writeHead(responseStatus, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload, "utf8")),
  });
  response.end(payload);
}

function createRequestLifecycle(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController();
  const abort = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", abort);
  response.once("close", abort);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.removeListener("aborted", abort);
      response.removeListener("close", abort);
    },
  };
}

export function startServer() {
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url || "/", "http://localhost").pathname;
    if (requestPath === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "GET" || !["/v1/hardware", "/v1/memory/processes", "/v1/processor/processes", "/v1/docker/containers"].includes(requestPath)) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(request, requestPath)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const lifecycle = createRequestLifecycle(request, response);
    try {
      const data = requestPath === "/v1/hardware"
        ? await hardwareSampler.getSnapshot()
        : requestPath === "/v1/processor/processes"
          ? await collectProcessorSnapshot({ signal: lifecycle.signal })
          : requestPath === "/v1/docker/containers"
            ? await collectDockerSnapshot({ signal: lifecycle.signal })
            : await collectSnapshot({ signal: lifecycle.signal });
      sendJson(response, 200, data, Boolean(lifecycle));
    } catch (error) {
      if (!response.destroyed && !isAbortError(error)) sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to collect system metrics" });
    } finally {
      lifecycle?.cleanup();
    }
  });

  const hardwareTimer = setInterval(() => {
    void hardwareSampler.refresh();
  }, 5_000);
  hardwareTimer.unref();
  void hardwareSampler.refresh();
  server.on("close", () => clearInterval(hardwareTimer));

  server.listen(port, "0.0.0.0", () => {
    console.log(`Nimbus metrics agent listening on port ${port}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
