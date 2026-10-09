"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import type { ActivityEvent, AppStatus, ManagedApp } from "@/lib/types";
import { ApplicationGrid } from "@/app/launcher/application-grid";
import { SystemOverview } from "@/app/launcher/system-overview";
import { nextAppSortOrder } from "@/lib/app-order";
import { SettingsPanel } from "@/app/launcher/settings-panel";
import { blankApp } from "@/app/launcher/utils";
import { fetchHealthStatus } from "@/lib/health-client";
import { mapWithConcurrency } from "@/lib/async-work";
import { applyHealthResults, hasHealthStatusTransition } from "@/lib/health-results";

function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  return <div className="offline-banner" role="status" aria-live="polite"><TriangleAlert size={16} aria-hidden="true" /><span>You’re offline. Showing the last successful data.</span><button type="button" className="small-primary" onClick={onRetry}>Retry</button></div>;
}

export default function Home() {
  const [apps, setApps] = useState<ManagedApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemDetailsOpen, setSystemDetailsOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedApp | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const motionTransition = reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" as const };
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const activeHealthRefreshesRef = useRef(0);
  const healthRefreshVersionRef = useRef(0);
  const healthRequestRef = useRef<AbortController | null>(null);
  const healthRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const healthRefreshGenerationRef = useRef(0);
  const activityRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const appsRequestRef = useRef<AbortController | null>(null);
  const appsLoadVersionRef = useRef(0);
  const appsDiscoveryRetryTimeoutRef = useRef<number | null>(null);
  const savedNoticeTimeoutRef = useRef<number | null>(null);
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
  const appsRef = useRef(apps);
  const loadAppsRef = useRef<((discoveryRetry?: number) => void) | null>(null);
  const refreshOverviewRef = useRef<(() => Promise<void>) | null>(null);
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

  useEffect(() => {
    if (settingsOpen) return;
    const trigger = settingsTriggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    settingsTriggerRef.current = null;
  }, [settingsOpen]);

  useEffect(() => () => {
    if (savedNoticeTimeoutRef.current !== null) window.clearTimeout(savedNoticeTimeoutRef.current);
    if (appsDiscoveryRetryTimeoutRef.current !== null) window.clearTimeout(appsDiscoveryRetryTimeoutRef.current);
    healthRequestRef.current?.abort();
    appsRequestRef.current?.abort();
  }, []);

  const loadApps = useCallback(async (discoveryRetry = 0) => {
    if (appsDiscoveryRetryTimeoutRef.current !== null) {
      window.clearTimeout(appsDiscoveryRetryTimeoutRef.current);
      appsDiscoveryRetryTimeoutRef.current = null;
    }
    const loadVersion = appsLoadVersionRef.current + 1;
    appsLoadVersionRef.current = loadVersion;
    appsRequestRef.current?.abort();
    const controller = new AbortController();
    appsRequestRef.current = controller;
    setAppsLoading(true);
    setAppsError("");
    try {
      const response = await fetch("/api/apps", { cache: "no-store", signal: controller.signal }).catch(() => null);
      const data = response ? await response.json().catch(() => ({})) as { apps?: ManagedApp[]; error?: string; docker?: { warnings?: string[] } } : {};
      if (response && !response.ok) await response.body?.cancel().catch(() => undefined);
      if (controller.signal.aborted || loadVersion !== appsLoadVersionRef.current) return;
      if (!response?.ok || !Array.isArray(data.apps)) throw new Error(data.error || "Unable to load applications.");
      appsRef.current = data.apps;
      setApps(data.apps);
      setEditing((current) => current ? data.apps?.find((app) => app.id === current.id) || current : null);
      setAppsError("");
      if (data.docker?.warnings?.includes("Docker discovery is still loading.") && discoveryRetry < 3) {
        appsDiscoveryRetryTimeoutRef.current = window.setTimeout(() => {
          appsDiscoveryRetryTimeoutRef.current = null;
          void loadAppsRef.current?.(discoveryRetry + 1);
        }, 1_000);
      }
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
  }, []);

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

  const modalOpen = settingsOpen || systemDetailsOpen;
  useEffect(() => {
    const appRoot = document.querySelector("body > div");
    if (!appRoot) return;
    if (modalOpen) appRoot.setAttribute("inert", "");
    else appRoot.removeAttribute("inert");
    return () => appRoot.removeAttribute("inert");
  }, [modalOpen]);


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

  const addApplication = useCallback(() => openSettings(blankApp(nextAppSortOrder(apps))), [apps, openSettings]);
  const openSettingsPanel = useCallback(() => openSettings(null), [openSettings]);
  const retryApps = useCallback(() => void loadApps(), [loadApps]);
  const refreshActivity = useCallback(() => void refreshActivities(), [refreshActivities]);

  return <>
    <SystemOverview
      children={<ApplicationGrid apps={apps} appsLoading={appsLoading} appsError={appsError} reducedMotion={reducedMotion} onAdd={addApplication} onRetry={retryApps} />}
      healthRefreshing={refreshing}
      settingsOpen={settingsOpen}
      onRefreshHealth={refreshHealth}
      onOpenSettings={openSettingsPanel}
      onModalOpenChange={setSystemDetailsOpen}
      refreshOverviewRef={refreshOverviewRef}
    />
    <AnimatePresence initial={false}>{settingsOpen && <motion.div key="application-modal" className="panel-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTransition} onClick={closeSettings}><SettingsPanel apps={apps} activities={activities} editing={editing} deletingId={deletingId} saving={saving} mutationError={mutationError} onRefreshActivity={refreshActivity} onClose={closeSettings} onEdit={setEditing} onSave={saveApp} onDelete={deleteApp} /></motion.div>}</AnimatePresence>
    {healthError && <div className="toast toast-error" role="status" aria-live="polite"><TriangleAlert size={16} aria-hidden="true" />{healthError}</div>}
    {isOnline === false && <OfflineBanner onRetry={() => { void loadApps(); void refreshOverviewRef.current?.(); void refreshHealth(); }} />}
    {savedNotice && <div className="toast" role="status"><Check size={16} aria-hidden="true" />Changes saved</div>}
    {mutationError && !settingsOpen && <div className="toast toast-error" role="alert"><TriangleAlert size={16} aria-hidden="true" />{mutationError}</div>}
  </>;
}
