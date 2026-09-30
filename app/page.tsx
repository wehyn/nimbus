"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Cpu, Database, HardDrive, RefreshCw, Settings2, Thermometer, TriangleAlert, Zap } from "lucide-react";
import type { ActivityEvent, AppStatus, ManagedApp, ServerOverview } from "@/lib/types";
import SystemDetailsModal, { type SystemDetailKind } from "@/app/system-details-modal";
import { AddApplicationTile, LauncherTile, SystemMetric } from "@/app/launcher/launcher-components";
import { SettingsPanel } from "@/app/launcher/settings-panel";
import { blankApp, formatNetworkRate, formatPercent, formatPower, formatTemperature } from "@/app/launcher/utils";
import { fetchHealthStatus } from "@/lib/health-client";
import { mapWithConcurrency } from "@/lib/async-work";
import { applyHealthResults, hasHealthStatusTransition } from "@/lib/health-results";

function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  return <div className="offline-banner" role="status" aria-live="polite"><TriangleAlert size={16} aria-hidden="true" /><span>You’re offline. Showing the last successful data.</span><button type="button" className="small-primary" onClick={onRetry}>Retry</button></div>;
}

const motionTransition = { duration: 0.2, ease: "easeOut" as const };
export default function Home() {
  const [apps, setApps] = useState<ManagedApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState("");
  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemDetails, setSystemDetails] = useState<SystemDetailKind | null>(null);
  const [editing, setEditing] = useState<ManagedApp | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [overviewRefreshing, setOverviewRefreshing] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [healthError, setHealthError] = useState("");
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const motionTransition = reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" as const };
  const overviewRef = useRef<ServerOverview | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [clockTime, setClockTime] = useState("");
  const [clockDate, setClockDate] = useState("");
  const activeHealthRefreshesRef = useRef(0);
  const healthRefreshVersionRef = useRef(0);
  const healthRequestRef = useRef<AbortController | null>(null);
  const overviewRequestRef = useRef<AbortController | null>(null);
  const healthRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const healthRefreshGenerationRef = useRef(0);
  const activityRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const appsRequestRef = useRef<AbortController | null>(null);
  const appsLoadVersionRef = useRef(0);
  const savedNoticeTimeoutRef = useRef<number | null>(null);
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
  const systemDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const appsRef = useRef(apps);
  const loadAppsRef = useRef<(() => void) | null>(null);
  const refreshOverviewRef = useRef<(() => void) | null>(null);
  const refreshHealthRef = useRef<(() => void) | null>(null);
  appsRef.current = apps;

  const openSettings = useCallback((nextEditing: ManagedApp | null) => {
    const activeElement = document.activeElement;
    settingsTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setMutationError("");
    setEditing(nextEditing);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setEditing(null);
  }, []);

  const openSystemDetails = useCallback((kind: SystemDetailKind) => {
    if (settingsOpen) return;
    const activeElement = document.activeElement;
    systemDetailsTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setSystemDetails(kind);
  }, [settingsOpen]);

  const closeSystemDetails = useCallback(() => {
    setSystemDetails(null);
  }, []);

  useEffect(() => {
    if (settingsOpen) return;
    const trigger = settingsTriggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    settingsTriggerRef.current = null;
  }, [settingsOpen]);

  useEffect(() => {
    if (systemDetails) return;
    const trigger = systemDetailsTriggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    systemDetailsTriggerRef.current = null;
  }, [systemDetails]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockTime(new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now));
      setClockDate(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now));
    };
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => () => {
    if (savedNoticeTimeoutRef.current !== null) window.clearTimeout(savedNoticeTimeoutRef.current);
    healthRequestRef.current?.abort();
    overviewRequestRef.current?.abort();
    appsRequestRef.current?.abort();
  }, []);

  const loadApps = useCallback(async () => {
    const loadVersion = appsLoadVersionRef.current + 1;
    appsLoadVersionRef.current = loadVersion;
    appsRequestRef.current?.abort();
    const controller = new AbortController();
    appsRequestRef.current = controller;
    setAppsLoading(true);
    setAppsError("");
    try {
      const response = await fetch("/api/apps", { cache: "no-store", signal: controller.signal }).catch(() => null);
      const data = response ? await response.json().catch(() => ({})) as { apps?: ManagedApp[]; error?: string } : {};
      if (response && !response.ok) await response.body?.cancel().catch(() => undefined);
      if (controller.signal.aborted || loadVersion !== appsLoadVersionRef.current) return;
      if (!response?.ok || !Array.isArray(data.apps)) throw new Error(data.error || "Unable to load applications.");
      appsRef.current = data.apps;
      setApps(data.apps);
      setAppsError("");
    } catch (caught) {
      if (!controller.signal.aborted && loadVersion === appsLoadVersionRef.current && !appsRef.current.length) setAppsError(caught instanceof Error ? caught.message : "Unable to load applications.");
    } finally {
      if (appsRequestRef.current === controller) {
        appsRequestRef.current = null;
        if (!controller.signal.aborted) setAppsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadAppsRef.current = loadApps;
  }, [loadApps]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const refreshActivities = useCallback(async () => {
    if (activityRefreshInFlightRef.current) return activityRefreshInFlightRef.current;
    const refreshPromise = (async () => {
      try {
        const response = await fetch("/api/activity", { cache: "no-store" }).catch(() => null);
        if (!response?.ok) return;
        const data = await response.json() as { activities?: ActivityEvent[] };
        if (data.activities) setActivities(data.activities);
      } catch {
        // Activity history is supplementary; a malformed response must not make an app mutation fail.
      } finally {
        activityRefreshInFlightRef.current = null;
      }
    })();
    activityRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    void refreshActivities();
  }, [refreshActivities]);

  const refreshOverview = useCallback(async () => {
    if (overviewRequestRef.current) return;
    const controller = new AbortController();
    overviewRequestRef.current = controller;
    setOverviewRefreshing(true);
    try {
      const response = await fetch("/api/overview", { cache: "no-store", signal: controller.signal }).catch(() => null);
      if (controller.signal.aborted) return;
      if (!response?.ok) throw new Error("Unable to load system overview.");
      const data = await response.json() as ServerOverview;
      setOverview(data);
      overviewRef.current = data;
      setOverviewError("");
    } catch (caught) {
      if (!controller.signal.aborted && !overviewRef.current) setOverviewError(caught instanceof Error ? caught.message : "Unable to load system overview.");
    } finally {
      if (overviewRequestRef.current === controller) overviewRequestRef.current = null;
      if (!controller.signal.aborted) setOverviewRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshOverviewRef.current = refreshOverview;
  }, [refreshOverview]);

  useEffect(() => {
    void refreshOverview();
    const interval = window.setInterval(() => void refreshOverview(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshOverview]);

  const refreshHealth = useCallback(async () => {
    if (healthRefreshInFlightRef.current) return healthRefreshInFlightRef.current;
    const refreshVersion = healthRefreshVersionRef.current + 1;
    healthRefreshVersionRef.current = refreshVersion;
    const checkedApps = appsRef.current.filter((app) => app.healthUrl || app.url);
    if (!checkedApps.length) {
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    const generation = healthRefreshGenerationRef.current;
    healthRequestRef.current = controller;
    activeHealthRefreshesRef.current += 1;
    setRefreshing(true);
    let refreshPromise: Promise<void> = Promise.resolve();
    refreshPromise = (async () => {
      try {
        const healthResults = await mapWithConcurrency(checkedApps, 8, async (app) => {
          const result = await fetchHealthStatus(`/api/health?id=${encodeURIComponent(app.id)}`, { signal: controller.signal });
          return { id: app.id, target: app.healthUrl || app.url, result };
        }).then((values) => values.map((value) => ({ status: "fulfilled" as const, value })))
          .catch((caught: unknown) => controller.signal.aborted ? [] : checkedApps.map(() => ({ status: "rejected" as const, reason: caught })));
        const results = healthResults;
        if (controller.signal.aborted || refreshVersion !== healthRefreshVersionRef.current) return;
        const failedResults = results.filter((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.result.kind !== "valid"));
        setHealthError(failedResults.length ? `${failedResults.length} service health check${failedResults.length === 1 ? "" : "s"} failed; showing the last known status.` : "");
        const validResults = results.flatMap((result) => result.status === "fulfilled" && result.value.result.kind === "valid"
          ? [{ id: result.value.id, target: result.value.target, status: result.value.result.response.status }]
          : []);
        const currentApps = appsRef.current;
        const nextApps = applyHealthResults(currentApps, validResults, checkedApps);
        appsRef.current = nextApps;
        setApps(nextApps);
        if (hasHealthStatusTransition(currentApps, validResults, checkedApps)) void refreshActivities();
      } catch (caught) {
        if (!controller.signal.aborted) setHealthError(caught instanceof Error ? caught.message : "Unable to refresh service health.");
      } finally {
        const isCurrentRequest = healthRequestRef.current === controller;
        if (generation === healthRefreshGenerationRef.current) {
          activeHealthRefreshesRef.current = Math.max(0, activeHealthRefreshesRef.current - 1);
          if (isCurrentRequest && refreshVersion === healthRefreshVersionRef.current) {
            healthRequestRef.current = null;
            setRefreshing(false);
          }
        }
        if (healthRefreshInFlightRef.current === refreshPromise) healthRefreshInFlightRef.current = null;
      }
    })();
    healthRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [refreshActivities]);

  useEffect(() => {
    refreshHealthRef.current = refreshHealth;
  }, [refreshHealth]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      void loadAppsRef.current?.();
      void refreshOverviewRef.current?.();
      void refreshHealthRef.current?.();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadApps, refreshOverview, refreshHealth]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(mediaQuery.matches);
    updateMotionPreference();
    mediaQuery.addEventListener?.("change", updateMotionPreference);
    return () => mediaQuery.removeEventListener?.("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (appsLoading) return;
    void refreshHealth();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshHealth();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshHealth();
    }, 30_000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      healthRequestRef.current?.abort();
      healthRefreshVersionRef.current += 1;
      healthRefreshGenerationRef.current += 1;
      healthRequestRef.current = null;
      healthRefreshInFlightRef.current = null;
      activeHealthRefreshesRef.current = 0;
    };
  }, [refreshHealth, appsLoading, apps.map((app) => `${app.id}:${app.healthUrl || app.url}:${app.casaosScheme || ""}:${app.casaosHostname || ""}:${app.casaosPortMap || ""}:${app.casaosIndex || ""}:${app.allowInsecureTls ? "insecure" : "strict"}`).join("|")]);

  const modalOpen = settingsOpen || systemDetails !== null;
  useEffect(() => {
    const appRoot = document.querySelector("body > div");
    if (!appRoot) return;
    if (modalOpen) appRoot.setAttribute("inert", "");
    else appRoot.removeAttribute("inert");
    return () => appRoot.removeAttribute("inert");
  }, [modalOpen]);

  const visibleApps = useMemo(() => apps.filter((app) => app.isVisible), [apps]);

  async function saveApp(app: ManagedApp) {
    if (saving) return;
    setSaving(true);
    setMutationError("");
    setSavedNotice(false);
    try {
      const response = await fetch("/api/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app) }).catch(() => null);
      const result = response ? await response.json().catch(() => null) as { app?: ManagedApp; error?: string } | null : null;
      if (!response?.ok || !result?.app) throw new Error(result?.error || "Unable to save application.");
      setApps((current) => current.some((item) => item.id === app.id) ? current.map((item) => item.id === app.id ? result.app! : item) : [...current, result.app!]);
      setAppsError("");
      await refreshActivities();
      setEditing(null);
      setSavedNotice(true);
      if (savedNoticeTimeoutRef.current !== null) window.clearTimeout(savedNoticeTimeoutRef.current);
      savedNoticeTimeoutRef.current = window.setTimeout(() => setSavedNotice(false), 2200);
      void loadApps();
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : "Unable to save application.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(id: string) {
    setMutationError("");
    setSavedNotice(false);
    setDeletingId(id);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const response = await fetch("/api/apps", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
      const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
      if (!response?.ok) throw new Error(result?.error || "Unable to delete application.");
      setApps((current) => current.filter((app) => app.id !== id));
      await refreshActivities();
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : "Unable to delete application.");
    } finally {
      setDeletingId(null);
    }
  }

  const cpuValue = overview ? formatPercent(overview.cpu) : "—";
  const memoryValue = overview ? formatPercent(overview.memory) : "—";
  const storageValue = overview ? formatPercent(overview.storage) : "—";
  const downloadValue = overview ? formatNetworkRate(overview.downloadBytesPerSecond) : "—";
  const uploadValue = overview ? formatNetworkRate(overview.uploadBytesPerSecond) : "—";
  const temperatureValue = overview ? formatTemperature(overview.temperatureC) : "—";
  const powerValue = overview ? formatPower(overview.powerWatts) : "—";

  let launcherContent: React.ReactNode;
  if (appsLoading) {
    launcherContent = <motion.div key="apps-loading" className="empty-state" role="status" aria-live="polite" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={motionTransition}><RefreshCw size={24} className="spin" aria-hidden="true" /><strong>Loading applications…</strong><span>Checking the application registry.</span></motion.div>;
  } else if (appsError) {
    launcherContent = <motion.div key="apps-error" className="empty-state" role="alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={motionTransition}><TriangleAlert size={28} aria-hidden="true" /><strong>Applications unavailable</strong><span>{appsError}</span><button type="button" className="small-primary" onClick={() => void loadApps()}>Try again</button></motion.div>;
  } else {
    launcherContent = <motion.div key="app-grid" className={`launcher-grid ${visibleApps.length ? "" : "launcher-grid-empty"}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTransition}><AnimatePresence initial={false} mode="popLayout">{visibleApps.map((app) => <motion.div key={app.id} className="launcher-tile-wrap" layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={motionTransition}><LauncherTile app={app} /></motion.div>)}<motion.div key="add-application" className="launcher-tile-wrap" layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={motionTransition}><AddApplicationTile onAdd={() => openSettings(blankApp(apps.length))} /></motion.div></AnimatePresence></motion.div>;
  }

  return <main className="launcher">
    <header className="launcher-bar">
      <div className="launcher-clock"><span className="launcher-time">{clockTime || "—"}</span><span className="launcher-date">{clockDate}</span></div>
      <div className="launcher-actions"><span className="launcher-uptime" role="status" aria-label={`System uptime: ${overview?.uptime || "—"}`}>{overview?.uptime || "—"}</span><button type="button" className="launcher-icon-button" onClick={() => { void refreshOverview(); void refreshHealth(); }} title={overviewError ? "Retry system metrics" : "Refresh metrics and service health"} aria-label={overviewError ? "Retry system metrics" : "Refresh metrics and service health"}><RefreshCw size={22} className={refreshing || overviewRefreshing ? "spin" : ""} /></button><button type="button" className="launcher-icon-button" onClick={() => openSettings(null)} aria-label="Application management" title="Application management"><Settings2 size={22} /></button></div>
    </header>
    <section className="launcher-body">
      <section className="launcher-system" aria-label="System overview">
        <div className="system-card" aria-busy={overviewRefreshing}>
          <div className="system-ring-grid">
            <SystemMetric icon={<Cpu size={24} />} label="CPU" value={cpuValue} progress={overview?.cpu} tone="green" variant="ring" onOpen={() => openSystemDetails("processor")} loading={overviewRefreshing} />
            <SystemMetric icon={<Database size={24} />} label="Memory" value={memoryValue} progress={overview?.memory} tone="blue" variant="ring" onOpen={() => openSystemDetails("memory")} loading={overviewRefreshing} />
          </div>
          <SystemMetric icon={<HardDrive size={24} />} label="Storage" value={storageValue} progress={overview?.storage} tone="orange" variant="bar" onOpen={() => openSystemDetails("storage")} loading={overviewRefreshing} />
          <div className="system-card-meta" role="group" aria-label="System readings">
            <span className="system-card-meta-item system-card-meta-upload" role="img" aria-label={`Upload rate: ${uploadValue}`}><ArrowUp size={15} aria-hidden="true" /><strong>{uploadValue}</strong></span>
            <span className="system-card-meta-item system-card-meta-download" role="img" aria-label={`Download rate: ${downloadValue}`}><ArrowDown size={15} aria-hidden="true" /><strong>{downloadValue}</strong></span>
            <span className="system-card-meta-item system-card-meta-temperature" role="img" aria-label={`Temperature: ${temperatureValue}`}><Thermometer size={16} aria-hidden="true" /><strong>{temperatureValue}</strong></span>
            <span className="system-card-meta-item system-card-meta-power" role="img" aria-label={`Power: ${powerValue}`}><Zap size={14} aria-hidden="true" /><strong>{powerValue}</strong></span>
          </div>
        </div>
      </section>
      <section className="launcher-apps" aria-label="Applications" aria-busy={appsLoading}>
        <AnimatePresence mode="wait" initial={false}>{launcherContent}</AnimatePresence>
      </section>
    </section>
    <AnimatePresence initial={false}>{settingsOpen && <motion.div key="application-modal" className="panel-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTransition} onClick={closeSettings}><SettingsPanel apps={apps} activities={activities} editing={editing} deletingId={deletingId} saving={saving} mutationError={mutationError} onRefreshActivity={() => void refreshActivities()} onClose={closeSettings} onEdit={setEditing} onSave={saveApp} onDelete={deleteApp} /></motion.div>}</AnimatePresence>
    <AnimatePresence initial={false}>{systemDetails && <SystemDetailsModal key={systemDetails} kind={systemDetails} overview={overview} overviewError={overviewError} onRefreshOverview={refreshOverview} onClose={closeSystemDetails} />}</AnimatePresence>
    {healthError && <div className="toast toast-error" role="status" aria-live="polite"><TriangleAlert size={16} aria-hidden="true" />{healthError}</div>}
    {isOnline === false && <OfflineBanner onRetry={() => { void loadApps(); void refreshOverview(); void refreshHealth(); }} />}
    {savedNotice && <div className="toast" role="status"><Check size={16} aria-hidden="true" />Changes saved</div>}
    {mutationError && !settingsOpen && <div className="toast toast-error" role="alert"><TriangleAlert size={16} aria-hidden="true" />{mutationError}</div>}
  </main>;
}
