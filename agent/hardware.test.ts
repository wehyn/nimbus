import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCpuTemperature } from "./hardware.ts";

test("does not report unrelated hwmon temperatures as CPU temperature", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-unrelated-hwmon-"));
  const classRoot = join(root, "class", "hwmon");
  const gpuSensor = join(root, "devices", "pci0000:03", "0000:03:00.0", "hwmon", "hwmon0");
  const storageSensor = join(classRoot, "hwmon1");
  const batterySensor = join(classRoot, "hwmon2");
  await Promise.all([classRoot, gpuSensor, storageSensor, batterySensor].map((path) => mkdir(path, { recursive: true })));
  await symlink("../../devices/pci0000:03/0000:03:00.0/hwmon/hwmon0", join(classRoot, "hwmon0"));
  await Promise.all([
    writeFile(join(gpuSensor, "name"), "amdgpu\n"),
    writeFile(join(gpuSensor, "temp1_label"), "junction\n"),
    writeFile(join(gpuSensor, "temp1_input"), "72000\n"),
    writeFile(join(storageSensor, "name"), "drivetemp\n"),
    writeFile(join(storageSensor, "temp1_label"), "drive\n"),
    writeFile(join(storageSensor, "temp1_input"), "41000\n"),
    writeFile(join(batterySensor, "name"), "battery\n"),
    writeFile(join(batterySensor, "temp1_label"), "ambient\n"),
    writeFile(join(batterySensor, "temp1_input"), "30000\n"),
  ]);

  try {
    assert.equal(await readCpuTemperature(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
