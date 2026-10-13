"use client";

import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowDown, ArrowUp, Cpu, Database, HardDrive, RefreshCw, Settings2, Thermometer, Zap } from "lucide-react";
import type { ManagedApp, ServerOverview } from "@/lib/types";
import SystemDetailsModal, { type SystemDetailKind } from "@/app/system-details-modal";
import { LauncherClock } from "@/app/launcher/launcher-clock";
import { LauncherDock, SystemMetric } from "@/app/launcher/launcher-components";
import { formatNetworkRate, formatPercent, formatPower, formatTemperature } from "@/app/launcher/utils";

type SystemOverviewProps = {
  apps: ManagedApp[];
  children: ReactNode;
  healthRefreshing: boolean;
  settingsOpen: boolean;
  onRefreshHealth: () => Promise<void>;
  onOpenSettings: () => void;
  onModalOpenChange: (open: boolean) => void;
  refreshOverviewRef: MutableRefObject<(() => Promise<void>) | null>;
};

function SystemOverviewComponent({ apps, children, healthRefreshing, settingsOpen, onRefreshHealth, onOpenSettings, onModalOpenChange, refreshOverviewRef }: SystemOverviewProps) {
  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [overviewRefreshing, setOverviewRefreshing] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [systemDetails, setSystemDetails] = useState<SystemDetailKind | null>(null);
  const overviewRef = useRef<ServerOverview | null>(null);
  const overviewRequestRef = useRef<AbortController | null>(null);
  const detailsTriggerRef = useRef<HTMLElement | null>(null);

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
    return () => {
      if (refreshOverviewRef.current === refreshOverview) refreshOverviewRef.current = null;
    };
  }, [refreshOverview, refreshOverviewRef]);

  useEffect(() => {
    void refreshOverview();
    const interval = window.setInterval(() => void refreshOverview(), 5_000);
    return () => {
      window.clearInterval(interval);
      overviewRequestRef.current?.abort();
      overviewRequestRef.current = null;
    };
  }, [refreshOverview]);

  useEffect(() => {
    onModalOpenChange(settingsOpen || systemDetails !== null);
  }, [onModalOpenChange, settingsOpen, systemDetails]);

  useEffect(() => {
    if (systemDetails) return;
    const trigger = detailsTriggerRef.current;
    if (trigger?.isConnected) trigger.focus();
    detailsTriggerRef.current = null;
  }, [systemDetails]);

  const openSystemDetails = useCallback((kind: SystemDetailKind) => {
    if (settingsOpen) return;
    const activeElement = document.activeElement;
    detailsTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setSystemDetails(kind);
  }, [settingsOpen]);
  const closeSystemDetails = useCallback(() => setSystemDetails(null), []);
  const cpuValue = overview ? formatPercent(overview.cpu) : "—";
  const memoryValue = overview ? formatPercent(overview.memory) : "—";
  const storageValue = overview ? formatPercent(overview.storage) : "—";
  const downloadValue = overview ? formatNetworkRate(overview.downloadBytesPerSecond) : "—";
  const uploadValue = overview ? formatNetworkRate(overview.uploadBytesPerSecond) : "—";
  const temperatureValue = overview ? formatTemperature(overview.temperatureC) : "—";
  const powerValue = overview ? formatPower(overview.powerWatts) : "—";
  const maxNetworkRate = Math.max(overview?.downloadBytesPerSecond || 0, overview?.uploadBytesPerSecond || 0, 1);
  const downloadWidth = (overview?.downloadBytesPerSecond || 0) / maxNetworkRate * 100;
  const uploadWidth = (overview?.uploadBytesPerSecond || 0) / maxNetworkRate * 100;

  return <>
    <main className="launcher" id="overview">
      <header className="launcher-bar">
        <div className="launcher-brand"><a className="launcher-brand-name" href="#overview" aria-label="Nimbus overview"><span className="launcher-brand-mark" aria-hidden="true">N</span><strong>Nimbus</strong></a><nav className="launcher-nav" aria-label="Main navigation"><a className="active" href="#overview" aria-current="page">Overview</a><a href="#services">Services</a></nav></div>
        <div className="launcher-actions"><span className="launcher-local"><i aria-hidden="true" />Local</span><LauncherClock /><span className="launcher-uptime" role="status" aria-label={`System uptime: ${overview?.uptime || "—"}`}>{overview?.uptime || "—"}</span><button type="button" className="launcher-icon-button" onClick={() => { void refreshOverview(); void onRefreshHealth(); }} title={overviewError ? "Retry system metrics" : "Refresh metrics and service health"} aria-label={overviewError ? "Retry system metrics" : "Refresh metrics and service health"}><RefreshCw size={17} className={healthRefreshing || overviewRefreshing ? "spin" : ""} /></button><button type="button" className="launcher-icon-button" onClick={onOpenSettings} aria-label="Application management" title="Application management"><Settings2 size={17} /></button></div>
      </header>
      <section className="launcher-body">
        <section className="launcher-system" aria-label="System overview">
          <div className="system-card" aria-busy={overviewRefreshing}>
            <article className="system-summary-card processor-card">
              <SystemMetric icon={<Cpu size={19} />} label="Processor" value={cpuValue} progress={overview?.cpu} tone="green" onOpen={() => openSystemDetails("processor")} loading={overviewRefreshing} />
              <div className="processor-telemetry" role="group" aria-label="Processor readings">
                <span className="system-card-meta-item system-card-meta-temperature" role="img" aria-label={`Temperature: ${temperatureValue}`}><Thermometer size={13} aria-hidden="true" /><strong>{temperatureValue}</strong></span>
                <span className="system-card-meta-item system-card-meta-power" role="img" aria-label={`Power: ${powerValue}`}><Zap size={13} aria-hidden="true" /><strong>{powerValue}</strong></span>
              </div>
            </article>
            <article className="system-summary-card">
              <SystemMetric icon={<Database size={19} />} label="Memory" value={memoryValue} progress={overview?.memory} tone="blue" onOpen={() => openSystemDetails("memory")} loading={overviewRefreshing} />
            </article>
            <article className="system-summary-card">
              <SystemMetric icon={<HardDrive size={19} />} label="Storage" value={storageValue} progress={overview?.storage} tone="orange" onOpen={() => openSystemDetails("storage")} loading={overviewRefreshing} />
            </article>
            <article className="system-summary-card network-summary-card">
              <div className="metric-head"><span>Network</span><span>Traffic</span></div>
              <div className="network-values">
                <span className="system-card-meta-item system-card-meta-download" role="img" aria-label={`Download rate: ${downloadValue}`}><ArrowDown size={13} aria-hidden="true" />{downloadValue}</span>
                <span className="system-card-meta-item system-card-meta-upload" role="img" aria-label={`Upload rate: ${uploadValue}`}><ArrowUp size={13} aria-hidden="true" />{uploadValue}</span>
              </div>
              <div className="network-meter" aria-hidden="true"><span><i className="download" style={{ width: `${downloadWidth}%` }} /></span><span><i className="upload" style={{ width: `${uploadWidth}%` }} /></span></div>
            </article>
          </div>
        </section>
        {children}
      </section>
      <LauncherDock apps={apps} onOpenSettings={onOpenSettings} />
      <AnimatePresence initial={false}>{systemDetails && <SystemDetailsModal key={systemDetails} kind={systemDetails} overview={systemDetails === "storage" ? overview : null} overviewError={systemDetails === "storage" ? overviewError : ""} onRefreshOverview={systemDetails === "storage" ? refreshOverview : undefined} onClose={closeSystemDetails} />}</AnimatePresence>
    </main>
  </>;
}

export const SystemOverview = memo(SystemOverviewComponent);
