"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { resolveAppLaunchUrl } from "@/lib/app-url";
import { isWebUrl } from "@/lib/app-validation";
import type { ManagedApp } from "@/lib/types";

type LaunchApp = Pick<ManagedApp, "id" | "name" | "url" | "containerId" | "dockerProject" | "dockerService">;

export default function AppViewer({ app }: { app: LaunchApp }) {
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [frameVersion, setFrameVersion] = useState(0);

  useEffect(() => {
    const resolvedUrl = resolveAppLaunchUrl(app, window.location.hostname);
    setLaunchUrl(isWebUrl(resolvedUrl) ? resolvedUrl : "");
  }, [app]);

  return (
    <main className="app-viewer">
      <header className="app-viewer-toolbar">
        <div className="app-viewer-brand">
          <Link className="app-viewer-back" href="/" aria-label="Back to dashboard" title="Back to dashboard">
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back</span>
          </Link>
          <h1 className="app-viewer-title">{app.name}</h1>
        </div>
        <div className="app-viewer-actions">
          <button
            className="app-viewer-action"
            type="button"
            aria-label="Reload"
            title="Reload"
            disabled={!launchUrl}
            onClick={() => setFrameVersion((version) => version + 1)}
          ><RefreshCw size={15} aria-hidden="true" /></button>
          {launchUrl && <a className="app-viewer-action" href={launchUrl} target="_blank" rel="noreferrer" aria-label="Open in new tab" title="Open in new tab"><ExternalLink size={15} aria-hidden="true" /></a>}
        </div>
      </header>
      {launchUrl ? (
        <iframe key={frameVersion} className="app-viewer-frame" src={launchUrl} title={app.name} />
      ) : launchUrl === null ? (
        <div className="app-viewer-state" role="status">Preparing app address…</div>
      ) : (
        <div className="app-viewer-state" role="alert">This app has an invalid web address and cannot be opened.</div>
      )}
    </main>
  );
}
