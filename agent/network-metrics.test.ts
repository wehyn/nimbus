import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NetworkRateSampler } from "./network-metrics.ts";

test("reports byte rates for lowest-metric IPv4 default route interfaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "nimbus-network-"));
  const networkRoot = join(root, "1", "net");
  await mkdir(networkRoot, { recursive: true });
  const route = [
    "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
    "eth0 00000000 0102A8C0 0003 0 0 100 00000000 0 0 0",
    "eth1 00000000 0102A8C0 0003 0 0 100 00000000 0 0 0",
    "eth2 00000000 0102A8C0 0003 0 0 200 00000000 0 0 0",
    "lo 00000000 00000000 0001 0 0 1 00000000 0 0 0",
  ].join("\n");
  const writeCounters = (eth0: number, eth1: number, eth2: number) => writeFile(join(networkRoot, "dev"), [
    "Inter-| Receive | Transmit",
    " face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed",
    `  eth0: ${eth0} 0 0 0 0 0 0 0 ${eth0 * 2} 0 0 0 0 0 0 0`,
    `  eth1: ${eth1} 0 0 0 0 0 0 0 ${eth1 * 3} 0 0 0 0 0 0 0`,
    `  eth2: ${eth2} 0 0 0 0 0 0 0 ${eth2} 0 0 0 0 0 0 0`,
    "   lo: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0",
  ].join("\n"));
  let now = 1_000;
  const sampler = new NetworkRateSampler(root, () => now);

  try {
    await writeFile(join(networkRoot, "route"), route);
    await writeCounters(100, 200, 300);
    assert.equal(await sampler.sample(), null);

    now += 2_000;
    await writeCounters(1_100, 2_200, 9_300);
    assert.deepEqual(await sampler.sample(), {
      receiveBytesPerSecond: 1_500,
      transmitBytesPerSecond: 4_000,
    });

    now += 1_000;
    await writeCounters(10, 20, 30);
    assert.equal(await sampler.sample(), null);

    now += 1_000;
    await writeCounters(20, 30, 40);
    assert.deepEqual(await sampler.sample(), {
      receiveBytesPerSecond: 20,
      transmitBytesPerSecond: 50,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
