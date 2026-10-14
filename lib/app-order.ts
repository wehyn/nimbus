import type { ManagedApp } from "@/lib/types";

export function nextAppSortOrder(apps: readonly Pick<ManagedApp, "sortOrder">[]): number {
  if (!apps.length) return 0;

  let highestOrder = apps[0].sortOrder;
  for (let index = 1; index < apps.length; index += 1) highestOrder = Math.max(highestOrder, apps[index].sortOrder);
  return highestOrder + 1;
}

export function reorderVisibleAppIds(apps: readonly Pick<ManagedApp, "id" | "isVisible">[], sourceId: string, targetId: string): string[] | null {
  const visibleIds = apps.filter((app) => app.isVisible).map((app) => app.id);
  const sourceIndex = visibleIds.indexOf(sourceId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;

  const reorderedVisibleIds = [...visibleIds];
  const [movedId] = reorderedVisibleIds.splice(sourceIndex, 1);
  reorderedVisibleIds.splice(targetIndex, 0, movedId);

  let visibleIndex = 0;
  return apps.map((app) => app.isVisible ? reorderedVisibleIds[visibleIndex++] : app.id);
}
