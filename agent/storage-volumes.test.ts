import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calculateFilesystemUsage, collectMountedStorageVolumes } from "./storage-volumes.ts";

test("separates used, available, and reserved filesystem blocks", () => {
  assert.deepEqual(calculateFilesystemUsage({ blocks: 100, bfree: 30, bavail: 20, bsize: 4_096 }), {
    totalBytes: 409_600,
    usedBytes: 286_720,
    availableBytes: 81_920,
    reservedBytes: 40_960,
    usedPercent: 70,
  });
});

test("reports mounted storage targets and ignores unmounted directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-storage-volumes-"));
  const mountedPath = join(root, "media drive");
  const unmountedPath = join(root, "not-a-mount");
  await Promise.all([mkdir(mountedPath), mkdir(join(unmountedPath, "nested"), { recursive: true })]);

  try {
    const mountInfo = `55 33 0:42 / ${root.replaceAll(" ", "\\040")} rw - overlay overlay rw\n56 55 259:1 / ${mountedPath.replaceAll(" ", "\\040")} rw - ext4 /dev/example rw`;
    const volumes = await collectMountedStorageVolumes(root, mountInfo);

    assert.deepEqual(volumes.map(({ id, label }) => ({ id, label })), [{ id: "disk:media drive", label: "Media Drive" }]);
    assert.ok((volumes[0].totalBytes ?? 0) > 0);
    assert.equal(volumes[0].usedBytes! + volumes[0].availableBytes! + volumes[0].reservedBytes!, volumes[0].totalBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
