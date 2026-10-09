import type { ManagedApp } from "@/lib/types";

export function nextAppSortOrder(apps: readonly Pick<ManagedApp, "sortOrder">[]): number {
  if (!apps.length) return 0;

  let highestOrder = apps[0].sortOrder;
  for (let index = 1; index < apps.length; index += 1) highestOrder = Math.max(highestOrder, apps[index].sortOrder);
  return highestOrder + 1;
}
