"use client";

import { memo, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { ManagedApp } from "@/lib/types";
import { AddApplicationTile, LauncherTile } from "@/app/launcher/launcher-components";

type ApplicationGridProps = {
  apps: ManagedApp[];
  appsLoading: boolean;
  appsError: string;
  reducedMotion: boolean;
  onAdd: () => void;
  onRetry: () => void;
};

const standardTransition = { duration: 0.2, ease: "easeOut" as const };
const reducedTransition = { duration: 0 };

function ApplicationGridComponent({ apps, appsLoading, appsError, reducedMotion, onAdd, onRetry }: ApplicationGridProps) {
  const visibleApps = useMemo(() => apps.filter((app) => app.isVisible), [apps]);
  const transition = reducedMotion ? reducedTransition : standardTransition;
  let launcherContent: React.ReactNode;
  if (appsLoading) {
    launcherContent = <motion.div key="apps-loading" className="empty-state" role="status" aria-live="polite" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}><RefreshCw size={24} className="spin" aria-hidden="true" /><strong>Loading applications…</strong><span>Checking the application registry.</span></motion.div>;
  } else if (appsError) {
    launcherContent = <motion.div key="apps-error" className="empty-state" role="alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transition}><TriangleAlert size={28} aria-hidden="true" /><strong>Applications unavailable</strong><span>{appsError}</span><button type="button" className="small-primary" onClick={onRetry}>Try again</button></motion.div>;
  } else {
    launcherContent = <motion.div key="app-grid" className={`launcher-grid ${visibleApps.length ? "" : "launcher-grid-empty"}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}><AnimatePresence initial={false} mode="popLayout">{visibleApps.map((app) => <motion.div key={app.id} className="launcher-tile-wrap" layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={transition}><LauncherTile app={app} /></motion.div>)}<motion.div key="add-application" className="launcher-tile-wrap" layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={transition}><AddApplicationTile onAdd={onAdd} /></motion.div></AnimatePresence></motion.div>;
  }

  return <section className="launcher-apps" aria-label="Applications" aria-busy={appsLoading}><AnimatePresence mode="wait" initial={false}>{launcherContent}</AnimatePresence></section>;
}

export const ApplicationGrid = memo(ApplicationGridComponent);
