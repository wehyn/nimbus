import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HardwareSampler, calculatePower, readCpuTemperature } from "./hardware.ts";
import { calculateCpuPercent, calculateProcessCpuPercent, collectProcessorSnapshot, collectSnapshot, sanitizeCommand } from "./process-agent.ts";

test("collectSnapshot reads memory and sorts processes by RSS", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-"));
  const procRoot = join(root, "proc");
  await mkdir(join(procRoot, "10"), { recursive: true });
  await mkdir(join(procRoot, "20"), { recursive: true });
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    256 kB\n");
  await writeFile(join(procRoot, "10", "status"), "Name: node\nUid: 1000 1000 1000 1000\nVmRSS: 128 kB\n");
  await writeFile(join(procRoot, "10", "cmdline"), "/usr/bin/node\0--token\0secret\0--port=3000\0");
  await writeFile(join(procRoot, "20", "status"), "Name: database\nUid: 0 0 0 0\nVmRSS: 64 kB\n");
  await writeFile(join(procRoot, "20", "cmdline"), "/usr/bin/database\0--foreground\0");
  const passwdPath = join(root, "passwd");
  await writeFile(passwdPath, "root:x:0:0:root:/root:/bin/sh\ndeveloper:x:1000:1000::/home/developer:/bin/sh\n");

  try {
    const snapshot = await collectSnapshot({ procRoot, passwdPath });
    assert.equal(snapshot.totalBytes, 1024 * 1024);
    assert.equal(snapshot.availableBytes, 256 * 1024);
    assert.equal(snapshot.usedBytes, 768 * 1024);
    assert.equal(snapshot.usedPercent, 75);
    assert.equal(snapshot.partial, false);
    assert.deepEqual(snapshot.processes.map((process) => process.pid), [10, 20]);
    assert.equal(snapshot.processes[0].user, "developer");
    assert.equal(snapshot.processes[0].rssBytes, 128 * 1024);
    assert.equal(snapshot.processes[0].memoryPercent, 12.5);
    assert.equal(snapshot.processes[0].command, "node --token=<redacted> <redacted> --port=3000");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caps large process collections and reports policy-omitted counts separately", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-large-"));
  const procRoot = join(root, "proc");
  const processCount = 520;
  await mkdir(procRoot, { recursive: true });
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    256 kB\n");
  await Promise.all(Array.from({ length: processCount }, async (_, index) => {
    const pid = 1000 + index;
    const processRoot = join(procRoot, String(pid));
    await mkdir(processRoot, { recursive: true });
    await Promise.all([
      writeFile(join(processRoot, "status"), `Name: process-${index}\nUid: 1000 1000 1000 1000\nVmRSS: ${index + 1} kB\n`),
      writeFile(join(processRoot, "cmdline"), `/usr/bin/process-${index}\0`),
    ]);
  }));
  const passwdPath = join(root, "passwd");
  await writeFile(passwdPath, "developer:x:1000:1000::/home/developer:/bin/sh\n");

  try {
    const snapshot = await collectSnapshot({ procRoot, passwdPath });
    assert.equal(snapshot.totalCount, processCount);
    assert.equal(snapshot.returnedCount, 256);
    assert.equal(snapshot.processes.length, 256);
    assert.equal(snapshot.unreadableCount, 0);
    assert.equal(snapshot.omittedCount, 0);
    assert.equal(snapshot.policyOmittedCount, processCount - 256);
    assert.equal(snapshot.policyOmittedReason, "process-limit");
    assert.equal(snapshot.partial, true);
    assert.match(snapshot.warnings.join(" "), /process limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports scan omissions once the process-directory bound is exceeded", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-scan-limit-"));
  const procRoot = join(root, "proc");
  const processCount = 1_030;
  await mkdir(procRoot, { recursive: true });
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    256 kB\n");
  await Promise.all(Array.from({ length: processCount }, async (_, index) => {
    const processRoot = join(procRoot, String(2000 + index));
    await mkdir(processRoot, { recursive: true });
    await Promise.all([
      writeFile(join(processRoot, "status"), `Name: process-${index}\nUid: 1000 1000 1000 1000\nVmRSS: 1 kB\n`),
      writeFile(join(processRoot, "cmdline"), `/usr/bin/process-${index}\0`),
    ]);
  }));
  const passwdPath = join(root, "passwd");
  await writeFile(passwdPath, "developer:x:1000:1000::/home/developer:/bin/sh\n");

  try {
    const snapshot = await collectSnapshot({ procRoot, passwdPath });
    assert.equal(snapshot.totalCount, processCount);
    assert.equal(snapshot.returnedCount, 256);
    assert.equal(snapshot.policyOmittedCount, processCount - 256);
    assert.equal(snapshot.policyOmittedReason, "scan-and-process-limit");
    assert.match(snapshot.warnings.join(" "), /scan limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectSnapshot reports processes that cannot be read", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-"));
  const procRoot = join(root, "proc");
  await mkdir(join(procRoot, "30"), { recursive: true });
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    512 kB\n");

  try {
    const snapshot = await collectSnapshot({ procRoot, passwdPath: join(root, "missing-passwd") });
    assert.equal(snapshot.processes.length, 0);
    assert.equal(snapshot.omittedCount, 1);
    assert.equal(snapshot.partial, true);
    assert.equal(snapshot.warnings.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizeCommand redacts sensitive arguments and bounds output", () => {
  assert.equal(sanitizeCommand("/usr/bin/app\0--password=secret", "app"), "app --password=<redacted>");
  assert.equal(sanitizeCommand("", "kernel-thread"), "kernel-thread");
  assert.equal(sanitizeCommand(`/usr/bin/app\0${"x".repeat(220)}`, "app").length, 180);
});

test("snapshot collectors redact compound long options and attached short password values", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-secret-flags-"));
  const procRoot = join(root, "proc");
  const processRoot = join(procRoot, "10");
  await mkdir(processRoot, { recursive: true });
  await writeFile(join(procRoot, "stat"), "cpu  100 0 50 850 0 0 0 0\ncpu0 100 0 50 850 0 0 0 0\n");
  await writeFile(join(procRoot, "loadavg"), "0.00 0.00 0.00 1/1 10\n");
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    256 kB\n");
  await writeFile(join(processRoot, "status"), "Name: app\nUid: 1000 1000 1000 1000\nVmRSS: 128 kB\n");
  await writeFile(join(processRoot, "cmdline"), "/usr/bin/app\0--db-password=db-secret-literal\0--access-token=token-secret-literal\0-pshort-secret-literal\0");
  await writeFile(join(processRoot, "stat"), "10 (app) S 1 1 1 1 1 1 1 1 1 1 100 20\n");
  const passwdPath = join(root, "passwd");
  await writeFile(passwdPath, "developer:x:1000:1000::/home/developer:/bin/sh\n");

  try {
    const memorySnapshot = await collectSnapshot({ procRoot, passwdPath });
    const processorSnapshot = await collectProcessorSnapshot({ procRoot, passwdPath });
    const expectedCommand = "app --db-password=<redacted> --access-token=<redacted> -p<redacted>";
    assert.equal(memorySnapshot.processes[0]?.command, expectedCommand);
    assert.equal(processorSnapshot.processes[0]?.command, expectedCommand);
    for (const snapshot of [memorySnapshot, processorSnapshot]) {
      assert.doesNotMatch(snapshot.processes[0]?.command ?? "", /db-secret-literal|token-secret-literal|short-secret-literal/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectProcessorSnapshot includes every readable process and load data", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-agent-"));
  const procRoot = join(root, "proc");
  await mkdir(join(procRoot, "10"), { recursive: true });
  await mkdir(join(procRoot, "20"), { recursive: true });
  await writeFile(join(procRoot, "stat"), "cpu  100 0 50 850 0 0 0 0\ncpu0 50 0 25 425 0 0 0 0\ncpu1 50 0 25 425 0 0 0 0\n");
  await writeFile(join(procRoot, "loadavg"), "1.25 0.75 0.50 1/100 20\n");
  await writeFile(join(procRoot, "meminfo"), "MemTotal:       1024 kB\nMemAvailable:    256 kB\n");
  await writeFile(join(procRoot, "10", "status"), "Name: node\nUid: 1000 1000 1000 1000\nVmRSS: 128 kB\n");
  await writeFile(join(procRoot, "10", "cmdline"), "/usr/bin/node\0server.js\0");
  await writeFile(join(procRoot, "10", "stat"), "10 (node) S 1 1 1 1 1 1 1 1 1 1 100 20\n");
  await writeFile(join(procRoot, "20", "status"), "Name: database\nUid: 0 0 0 0\nVmRSS: 64 kB\n");
  await writeFile(join(procRoot, "20", "cmdline"), "/usr/bin/database\0--foreground\0");
  await writeFile(join(procRoot, "20", "stat"), "20 (database) S 1 1 1 1 1 1 1 1 1 1 50 10\n");
  const passwdPath = join(root, "passwd");
  await writeFile(passwdPath, "root:x:0:0:root:/root:/bin/sh\ndeveloper:x:1000:1000::/home/developer:/bin/sh\n");

  try {
    const snapshot = await collectProcessorSnapshot({ procRoot, passwdPath });
    assert.equal(snapshot.cpuCores, 2);
    assert.deepEqual(snapshot.loadAverage, { one: 1.25, five: 0.75, fifteen: 0.5 });
    assert.equal(snapshot.processes.length, 2);
    assert.deepEqual(snapshot.processes.map((process) => process.pid).sort(), [10, 20]);
    assert.equal(snapshot.processes.find((process) => process.pid === 10)?.command, "node server.js");
    assert.equal(snapshot.processes.find((process) => process.pid === 10)?.memoryPercent, 12.5);
    assert.equal(snapshot.sampling, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CPU percentages use total system CPU as the denominator", () => {
  assert.equal(calculateCpuPercent(200, 50), 75);
  assert.equal(calculateProcessCpuPercent(50, 200), 25);
  assert.equal(calculateProcessCpuPercent(-10, 200), 0);
  assert.equal(calculateCpuPercent(200, -50), 100);
  assert.equal(calculateProcessCpuPercent(500, 200), 100);
  assert.equal(calculateCpuPercent(Number.NaN, 0), 0);
});

test("HardwareSampler reads CPU temperature and derives RAPL watts from cached samples", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-hardware-"));
  const thermalZone = join(root, "devices", "virtual", "thermal", "thermal_zone0");
  const energyPath = join(root, "class", "powercap", "intel-rapl", "intel-rapl:0", "energy_uj");
  await mkdir(thermalZone, { recursive: true });
  await mkdir(join(root, "class", "powercap", "intel-rapl", "intel-rapl:0"), { recursive: true });
  await writeFile(join(thermalZone, "type"), "x86_pkg_temp\n");
  await writeFile(join(thermalZone, "temp"), "42500\n");
  await writeFile(energyPath, "1000000\n");

  let now = 10_000;
  const sampler = new HardwareSampler(root, () => now, join(root, "proc"), join(root, "storage"));
  try {
    const first = await sampler.getSnapshot();
    assert.equal(first.temperatureC, 43);
    assert.equal(first.powerWatts, null);
    assert.equal(first.powerSource, "intel-rapl");
    assert.equal(first.networkRates, null);
    assert.deepEqual(first.storageVolumes, []);

    await writeFile(energyPath, "1500000\n");
    now += 2_000;
    const cached = await sampler.getSnapshot();
    assert.equal(cached.updatedAt, first.updatedAt);
    assert.equal(cached.powerWatts, null);

    await writeFile(thermalZone + "/temp", "44500\n");
    now += 3_000;
    const second = await sampler.getSnapshot();
    assert.equal(second.temperatureC, 45);
    assert.equal(second.powerWatts, 0.1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("power conversion rejects missing baselines and counter resets", () => {
  assert.equal(calculatePower(1_000_000, undefined, 5_000), null);
  assert.equal(calculatePower(500_000, { microjoules: 1_000_000, timestampMs: 0 }, 5_000), null);
  assert.equal(calculatePower(1_500_000, { microjoules: 1_000_000, timestampMs: 0 }, 5_000), 0.1);
});

test("finds CPU temperature sensors through arbitrary hwmon class links", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-hwmon-"));
  const device = join(root, "devices", "platform", "coretemp.0", "hwmon", "hwmon2");
  const classRoot = join(root, "class", "hwmon");
  await mkdir(device, { recursive: true });
  await mkdir(classRoot, { recursive: true });
  await writeFile(join(device, "name"), "coretemp\n");
  await writeFile(join(device, "temp1_input"), "52000\n");
  await symlink("../../devices/platform/coretemp.0/hwmon/hwmon2", join(classRoot, "hwmon2"));

  try {
    assert.equal(await readCpuTemperature(root), 52);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
