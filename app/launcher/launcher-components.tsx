import { resolveAppLaunchUrl } from "@/lib/app-url";
import type { ReactNode } from "react";
import { memo } from "react";
import type { ManagedApp } from "@/lib/types";
import { Home, Settings2 } from "lucide-react";
import { AppIcon } from "./icons";
import { statusCopy } from "./utils";

export const LauncherTile = memo(function LauncherTile({ app }: { app: ManagedApp }) {
  const launchUrl = resolveAppLaunchUrl(app, typeof window === "undefined" ? undefined : window.location.hostname);

  return <a key={`${app.id}:${launchUrl}`} className="launcher-tile" href={launchUrl} target="_blank" rel="noreferrer" aria-label={`${app.name} · ${statusCopy[app.status]}`} title={`${app.name} · ${statusCopy[app.status]}`}>
    <span className="launcher-iconwrap"><AppIcon app={app} large /></span>
    <span className="launcher-app-name">{app.name}</span>
    <span className={`launcher-app-status ${app.status}`}><i aria-hidden="true" />{statusCopy[app.status]}</span>
  </a>;
});

export const LauncherDock = memo(function LauncherDock({ apps, onOpenSettings }: { apps: ManagedApp[]; onOpenSettings: () => void }) {
  const dockApps = apps.filter((app) => app.isVisible).slice(0, 4);

  return <nav className="launcher-dock" aria-label="Quick launch">
    <a className="dock-icon" href="#overview" aria-label="Overview" title="Overview"><Home size={18} aria-hidden="true" /></a>
    <span className="dock-divider" aria-hidden="true" />
    {dockApps.map((app) => <a className="dock-icon" key={app.id} href={resolveAppLaunchUrl(app, typeof window === "undefined" ? undefined : window.location.hostname)} target="_blank" rel="noreferrer" aria-label={`Open ${app.name}`} title={app.name}><AppIcon app={app} /></a>)}
    <span className="dock-divider" aria-hidden="true" />
    <button type="button" className="dock-icon" onClick={onOpenSettings} aria-label="Settings" title="Settings"><Settings2 size={17} aria-hidden="true" /></button>
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
      ? <button type="button" className="system-metric-bar system-metric-link" onClick={onOpen} aria-label={`View ${metricLabel.toLowerCase()} details`}>{content}</button>
      : <div className="system-metric-bar">{content}</div>}
    <span className="system-meter" role="progressbar" aria-label={`${metricLabel} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === undefined ? undefined : Math.round(clamped)}>
      <span className={`system-meter-fill ${tone}`} style={{ width: `${clamped}%` }} />
    </span>
  </div>;
}
