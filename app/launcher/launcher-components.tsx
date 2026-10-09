import { resolveAppLaunchUrl } from "@/lib/app-url";
import type { ReactNode } from "react";
import { memo } from "react";
import type { ManagedApp } from "@/lib/types";
import { Plus } from "lucide-react";
import { AppIcon } from "./icons";
import { statusCopy } from "./utils";

export const LauncherTile = memo(function LauncherTile({ app }: { app: ManagedApp }) {
  const launchUrl = resolveAppLaunchUrl(app, typeof window === "undefined" ? undefined : window.location.hostname);

  return <a key={`${app.id}:${launchUrl}`} className="launcher-tile" href={launchUrl} target="_blank" rel="noreferrer" aria-label={app.name} title={`${app.name} · ${statusCopy[app.status]}`}>
    <span className="launcher-iconwrap"><AppIcon app={app} large /></span>
  </a>;
});

export const AddApplicationTile = memo(function AddApplicationTile({ onAdd }: { onAdd: () => void }) {
  return <button type="button" className="launcher-tile launcher-add-tile" onClick={onAdd} aria-label="Add application" title="Add application">
    <span className="launcher-iconwrap"><span className="app-icon app-icon-large add-app-icon"><svg className="add-app-border" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M 18 1 H 82 C 91.4 1 99 8.6 99 18 V 82 C 99 91.4 91.4 99 82 99 H 18 C 8.6 99 1 91.4 1 82 V 18 C 1 8.6 8.6 1 18 1 Z" /></svg><Plus className="add-app-plus" size={32} strokeWidth={1.35} aria-hidden="true" /></span></span>
  </button>;
});

export function SystemMetric({ icon, label, value, progress, tone, onOpen, loading = false, variant = "bar" }: { icon: ReactNode; label: string; value: string; progress?: number; tone: "green" | "blue" | "orange"; onOpen?: () => void; loading?: boolean; variant?: "ring" | "bar" }) {
  const clamped = progress === undefined ? 0 : Math.min(100, Math.max(0, progress));
  const ring = variant !== "bar";
  const metricClass = ring ? "system-metric-ring" : "system-metric-storage";
  const content = ring ? <>
    <span className="system-ring-header"><span className={`system-metric-icon ${tone}`}>{icon}</span><span className="system-metric-label">{label}</span></span>
    <span
      className="system-ring-wrap"
      role="progressbar"
      aria-label={`${label} usage`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress !== undefined ? Math.round(clamped) : undefined}
    >
      <svg className={`system-ring-svg ${tone}`} viewBox="0 0 120 120" aria-hidden="true">
        <circle className="system-ring-track" cx="60" cy="60" r="45" pathLength="100" strokeDasharray="78 22" />
        <circle className="system-ring-fill" cx="60" cy="60" r="45" pathLength="100" strokeDasharray={`${clamped * .78} ${100 - (clamped * .78)}`} />
      </svg>
      <strong className="system-ring-value">{value}</strong>
    </span>
  </> : <>
    <span className={`system-metric-icon ${tone}`}>{icon}</span>
    <span className="system-metric-label">{label}</span>
    <strong className="system-metric-value">{value}</strong>
    <span className="system-meter" role="progressbar" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === undefined ? undefined : Math.round(clamped)}>
      <span className={`system-meter-fill ${tone}`} style={{ width: `${clamped}%` }} />
    </span>
  </>;

  return onOpen
    ? <button type="button" className={`system-metric ${metricClass} system-metric-link`} onClick={onOpen} aria-label={`View ${label.toLowerCase()} details`} aria-busy={loading}>{content}</button>
    : <div className={`system-metric ${metricClass}`} aria-busy={loading}>{content}</div>;
}
