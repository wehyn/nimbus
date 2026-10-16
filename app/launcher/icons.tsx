import { Activity, Cloud, FolderKanban, LayoutGrid, Network, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import type { ManagedApp } from "@/lib/types";
import { getIconSources } from "@/lib/icon-sources";

const iconPalette: Record<string, ComponentType<ComponentProps<typeof Cloud>>> = {
  "crafty-controller": GamepadIcon,
  "cloud-drive": Cloud,
  immich: Sparkles,
  jellyfin: PlayIcon,
  "adguard-home": ShieldCheck,
  "uptime-kuma": Activity,
  paperless: FolderKanban,
  router: Network,
};

function GamepadIcon(props: ComponentProps<typeof Cloud>) {
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.4 9.2h11.2a4.6 4.6 0 0 1 4.3 6.2l-1 2.8a2.5 2.5 0 0 1-4.4.5l-1.7-2.2H9.2l-1.7 2.2a2.5 2.5 0 0 1-4.4-.5l-1-2.8a4.6 4.6 0 0 1 4.3-6.2Z"/><path d="M7 12v4m-2-2h4m8-1h.01m2 2h.01"/></svg>;
}

function PlayIcon(props: ComponentProps<typeof Cloud>) {
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m10 8 5 4-5 4V8Z"/></svg>;
}

export function AppIcon({ app, large = false }: { app: ManagedApp; large?: boolean }) {
  const Icon = iconPalette[app.id] || LayoutGrid;
  const iconSources = getIconSources(app);
  const [failedSourceCount, setFailedSourceCount] = useState(0);
  useEffect(() => setFailedSourceCount(0), [app.id, app.name, app.icon, app.url]);
  const iconSource = iconSources[failedSourceCount] || "";

  return <div className={`app-icon ${large ? "app-icon-large" : ""}`} data-app-id={app.id}>
    {iconSource ? <img key={iconSource} src={iconSource} alt="" aria-hidden="true" width={large ? 144 : 40} height={large ? 144 : 40} loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" onError={() => setFailedSourceCount((current) => current + 1)} /> : <Icon size={large ? 27 : 22} strokeWidth={1.8} aria-hidden="true" focusable="false" />}
  </div>;
}
