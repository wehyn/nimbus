"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
          <Link className="app-viewer-home" href="/">Nimbus</Link>
          <h1 className="app-viewer-title">{app.name}</h1>
        </div>
        <div className="app-viewer-actions">
          <button
            className="app-viewer-action"
            type="button"
            disabled={!launchUrl}
            onClick={() => setFrameVersion((version) => version + 1)}
          >
            Reload
          </button>
          {launchUrl && <a className="app-viewer-action" href={launchUrl} target="_blank" rel="noreferrer">Open in new tab</a>}
        </div>
      </header>
      <p className="app-viewer-hint">Some apps block framing or sign-in. If this frame is blank or login fails, open the app in a new tab.</p>
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
