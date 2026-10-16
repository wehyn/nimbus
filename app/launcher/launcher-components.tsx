import Link from "next/link";
import type { ReactNode } from "react";
import { memo, useEffect, useState } from "react";
import { encodeAppRouteId } from "@/lib/app-url";
import type { ManagedApp } from "@/lib/types";
import { Home, Settings2 } from "lucide-react";
import { AppIcon } from "./icons";
import { ReorderableApp } from "./reorderable-app";
import { statusCopy } from "./utils";

export const LauncherTile = memo(function LauncherTile({ app }: { app: ManagedApp }) {
  return <Link className="launcher-tile" href={`/apps/app-${encodeAppRouteId(app.id)}`} draggable={false} aria-label={`${app.name} · ${statusCopy[app.status]}`} title={`${app.name} · ${statusCopy[app.status]}`}>
    <span className="launcher-iconwrap"><AppIcon app={app} large /></span>
    <span className="launcher-app-name">{app.name}</span>
    <span className={`launcher-app-status ${app.status}`}><i aria-hidden="true" />{statusCopy[app.status]}</span>
  </Link>;
});

export const LauncherDock = memo(function LauncherDock({ apps, onOpenSettings, onReorderApps, reorderingApps }: { apps: ManagedApp[]; onOpenSettings: () => void; onReorderApps: (sourceId: string, targetId: string) => Promise<boolean>; reorderingApps: boolean }) {
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const visibleApps = apps.filter((app) => app.isVisible);
  const orderedIds = visibleApps.map((app) => app.id);
  const dockApps = visibleApps.slice(0, 4);

  function announceReorder(message: string) {
    setReorderAnnouncement("");
    window.requestAnimationFrame(() => setReorderAnnouncement(message));
  }

  useEffect(() => {
    if (!pendingFocusId || visibleApps.findIndex((app) => app.id === pendingFocusId) < 4) return;
    const gridItem = Array.from(document.querySelectorAll<HTMLElement>(".launcher-grid [data-reorder-id]")).find((item) => item.dataset.reorderId === pendingFocusId);
    const gridHandle = gridItem?.querySelector<HTMLButtonElement>(".app-reorder-handle");
    if (!gridHandle) return;
    gridHandle.focus();
    setPendingFocusId(null);
  }, [apps, pendingFocusId, reorderingApps, visibleApps]);

  return <nav className="launcher-dock" aria-label="Quick launch">
    <a className="dock-icon" href="#overview" aria-label="Overview" title="Overview"><Home size={18} aria-hidden="true" /></a>
    <span className="dock-divider" aria-hidden="true" />
    {dockApps.map((app) => <ReorderableApp key={app.id} appId={app.id} appName={app.name} orderedIds={orderedIds} surface="dock" disabled={reorderingApps} onReorder={onReorderApps} onAnnounce={announceReorder} onFocusOut={setPendingFocusId}><Link className="dock-icon" href={`/apps/app-${encodeAppRouteId(app.id)}`} draggable={false} aria-label={`Open ${app.name}`} title={app.name}><AppIcon app={app} /></Link></ReorderableApp>)}
    <span className="dock-divider" aria-hidden="true" />
    <button type="button" className="dock-icon" onClick={onOpenSettings} aria-label="Settings" title="Settings"><Settings2 size={17} aria-hidden="true" /></button>
    <span className="visually-hidden" role="status" aria-live="polite">{reorderAnnouncement}</span>
  </nav>;
});

export function SystemMetric({ icon, label, value, progress, tone, onOpen, loading = false, accessibilityLabel }: { icon: ReactNode; label: string; value: string; progress?: number; tone: "green" | "blue" | "orange"; onOpen?: () => void; loading?: boolean; accessibilityLabel?: string }) {
  const clamped = progress === undefined ? 0 : Math.min(100, Math.max(0, progress));
  const metricLabel = accessibilityLabel || label;
  const content = <>
    <span className={`system-metric-icon ${tone}`}>{icon}</span>
    <span className="system-metric-label">{label}</span>
    <strong className="system-metric-value">{value}</strong>
  </>;

  return <div className="system-metric" aria-busy={loading}>
    {onOpen
      ? <button type="button" className="system-metric-bar system-metric-link" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpen(); }} aria-label={`View ${metricLabel.toLowerCase()} details`}>{content}</button>
      : <div className="system-metric-bar">{content}</div>}
    <span className="system-meter" role="progressbar" aria-label={`${metricLabel} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === undefined ? undefined : Math.round(clamped)}>
      <span className={`system-meter-fill ${tone}`} style={{ width: `${clamped}%` }} />
    </span>
  </div>;
}
