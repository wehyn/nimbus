"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpDown, Cpu, Database, HardDrive, RefreshCw, TriangleAlert, X } from "lucide-react";
import { getNextProcessSortDirection, getProcessSortButtonLabel, getProcessTableCaption } from "@/lib/system-details-accessibility";
import type { CpuProcess, MemoryProcess, MemorySnapshot, ProcessorSnapshot, ServerOverview, StorageVolume } from "@/lib/types";
import MetricsHistoryChart from "@/app/metrics-history-chart";
import { getFocusableElements } from "@/app/modal-focus.tsx";

export type SystemDetailKind = "processor" | "memory" | "storage";
type SortKey = "name" | "command" | "pid" | "user" | "cpuPercent" | "rssBytes" | "memoryPercent";

const processorSortLabels: Partial<Record<SortKey, string>> = {
  name: "Process",
  command: "Command",
  pid: "PID",
  user: "User",
  cpuPercent: "CPU %",
  rssBytes: "RSS",
  memoryPercent: "RAM %",
};

const memorySortLabels: Partial<Record<SortKey, string>> = {
  name: "Process",
  command: "Command",
  pid: "PID",
  user: "User",
  rssBytes: "RSS",
  memoryPercent: "RAM %",
};

const motionTransition = { duration: 0.2, ease: "easeOut" as const };

export default function SystemDetailsModal({ kind, onClose, overview = null, overviewError = "", onRefreshOverview }: {
  kind: SystemDetailKind;
  onClose: () => void;
  overview?: ServerOverview | null;
  overviewError?: string;
  onRefreshOverview?: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | ProcessorSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(kind === "processor" ? "cpuPercent" : "rssBytes");
  const [descending, setDescending] = useState(true);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const restoreFocusTimeoutRef = useRef<number | null>(null);
  const previousBodyOverflowRef = useRef("");
  const title = kind === "processor" ? "Processor" : kind === "memory" ? "Memory" : "Storage";
  const isStorage = kind === "storage";
  const visibleError = isStorage ? overviewError || error : error;
  const hasData = isStorage ? overview !== null : snapshot !== null;
  const updatedAt = isStorage ? overview?.updatedAt : snapshot?.updatedAt;
  const isBusy = isStorage ? overview === null && !visibleError : snapshot === null && !error;
  const sortLabels = kind === "processor" ? processorSortLabels : memorySortLabels;

  const refresh = useCallback(async () => {
    if (kind === "storage") {
      setRefreshing(true);
      try {
        await onRefreshOverview?.();
        setError("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to refresh storage details.");
      } finally {
        setRefreshing(false);
      }
      return;
    }

    requestRef.current?.abort();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    try {
      const endpoint = kind === "processor" ? "/api/processor/processes" : "/api/memory/processes";
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({})) as (MemorySnapshot | ProcessorSnapshot) & { error?: string };
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
      if (!response.ok) {
        const errorMessage = data.error || `Unable to load ${title.toLowerCase()} details.`;
        await response.body?.cancel().catch(() => undefined);
        throw new Error(errorMessage);
      }
      setSnapshot(data);
      setError("");
    } catch (caught) {
      if (!controller.signal.aborted && requestVersion === requestVersionRef.current) setError(caught instanceof Error ? caught.message : `Unable to load ${title.toLowerCase()} details.`);
    } finally {
      if (requestVersion === requestVersionRef.current) setRefreshing(false);
    }
  }, [kind, title, onRefreshOverview]);

  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void refresh();
    const interval = kind === "storage" ? null : window.setInterval(() => void refresh(), 5_000);
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      if (interval !== null) window.clearInterval(interval);
      requestRef.current?.abort();
      requestVersionRef.current += 1;
      requestRef.current = null;
      if (restoreFocusTimeoutRef.current !== null) {
        window.clearTimeout(restoreFocusTimeoutRef.current);
        restoreFocusTimeoutRef.current = null;
      }
      document.body.style.overflow = previousBodyOverflowRef.current;
      const previousTrigger = previousActiveElementRef.current;
      const restoreFocusVersion = requestVersionRef.current;
      restoreFocusTimeoutRef.current = window.setTimeout(() => {
        restoreFocusTimeoutRef.current = null;
        if (restoreFocusVersion !== requestVersionRef.current) return;
        previousTrigger?.isConnected && previousTrigger.focus();
      }, 220);
    };
  }, [refresh, kind]);

  useEffect(() => () => {
    if (restoreFocusTimeoutRef.current !== null) window.clearTimeout(restoreFocusTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusableElements = panelRef.current ? getFocusableElements(panelRef.current) : [];
      if (!focusableElements.length) {
        event.preventDefault();
        return;
      }
      const activeElement = document.activeElement;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeIndex = focusableElements.indexOf(activeElement as HTMLElement);
      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeIndex === focusableElements.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const processes = useMemo(() => {
    if (!snapshot) return [] as Array<CpuProcess | MemoryProcess>;
    if (kind === "processor") {
      return [...(snapshot as ProcessorSnapshot).processes].sort((left, right) => compareProcesses(left, right, sortKey, descending));
    }
    return [...(snapshot as MemorySnapshot).processes].sort((left, right) => compareProcesses(left, right, sortKey, descending));
  }, [snapshot, kind, sortKey, descending]);

  function changeSort(nextKey: SortKey) {
    if (nextKey === sortKey) setDescending((current) => !current);
    else {
      setSortKey(nextKey);
      setDescending(nextKey === "cpuPercent" || nextKey === "rssBytes" || nextKey === "memoryPercent");
    }
  }

  const processorSnapshot = kind === "processor" && snapshot ? snapshot as ProcessorSnapshot : null;
  const memorySnapshot = kind === "memory" && snapshot ? snapshot as MemorySnapshot : null;

  return <motion.div className="panel-backdrop system-details-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTransition} onClick={onClose}>
    <section ref={panelRef} className={`settings-panel system-details-modal${isStorage ? " storage-details-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="system-details-title" aria-busy={isBusy} onClick={(event) => event.stopPropagation()}>
      <div className="panel-header system-details-header">
        <div>
          <p className="eyebrow">System detail</p>
          <h2 id="system-details-title">{title}</h2>
          <p className="system-details-description">{isStorage ? "Used space for Nimbus and mounted disks." : `Host processes using ${kind === "processor" ? "CPU" : "RAM"} on this device.`}</p>
        </div>
        <div className="system-details-actions">
          <span className="system-details-status" role="status" aria-live="polite">
            {visibleError ? <TriangleAlert size={13} aria-hidden="true" /> : hasData ? <span className="sync-dot" aria-hidden="true" /> : <RefreshCw size={13} className="spin" aria-hidden="true" />}
            {visibleError ? "Unavailable" : hasData && updatedAt ? `Updated ${formatTime(updatedAt)}` : "Loading…"}
          </span>
          <button type="button" className="icon-button system-details-refresh" onClick={() => void refresh()} title={visibleError ? `Retry ${title.toLowerCase()} details` : `Refresh ${title.toLowerCase()} details`} aria-label={visibleError ? `Retry ${title.toLowerCase()} details` : `Refresh ${title.toLowerCase()} details`}><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button>
          <button type="button" ref={closeButtonRef} className="close-button" onClick={onClose} aria-label={`Close ${title.toLowerCase()} details`}><X size={18} aria-hidden="true" /></button>
        </div>
      </div>

      {isStorage ? <StorageDetails overview={overview} error={visibleError} refreshing={refreshing} onRefresh={() => void refresh()} /> : <>
      {processorSnapshot && <section className="memory-summary system-details-summary">
        <SystemSummary label="CPU usage" value={formatPercent(processorSnapshot.cpuPercent)} detail={`${processorSnapshot.cpuCores} logical cores`} tone="green" icon={<Cpu size={16} />} />
        <SystemSummary label="Load average" value={processorSnapshot.loadAverage.one.toFixed(2)} detail={`5m ${processorSnapshot.loadAverage.five.toFixed(2)} · 15m ${processorSnapshot.loadAverage.fifteen.toFixed(2)}`} tone="purple" icon={<Cpu size={16} />} />
        <SystemSummary label="Processes" value={`${processorSnapshot.returnedCount} / ${processorSnapshot.totalCount}`} detail={processSummaryDetail(processorSnapshot)} tone="blue" icon={<Cpu size={16} />} />
      </section>}
      {memorySnapshot && <section className="memory-summary system-details-summary">
        <SystemSummary label="Used" value={formatBytes(memorySnapshot.usedBytes)} detail={`${memorySnapshot.usedPercent}% of total`} tone="blue" icon={<Database size={16} />} />
        <SystemSummary label="Available" value={formatBytes(memorySnapshot.availableBytes, 2)} detail="Ready for workloads" tone="green" icon={<Database size={16} />} />
        <SystemSummary label="Total" value={formatBytes(memorySnapshot.totalBytes, 2)} detail={processSummaryDetail(memorySnapshot)} tone="purple" icon={<Database size={16} />} />
      </section>}

      {processorSnapshot?.sampling && <SystemNotice tone="info" icon={<RefreshCw size={16} className="spin" />} title="Sampling CPU usage">The first reading establishes a baseline; the next refresh will be more representative.</SystemNotice>}
      {(processorSnapshot?.partial || memorySnapshot?.partial) && <SystemNotice tone="warning" icon={<TriangleAlert size={16} />} title="Some process details are incomplete">{(processorSnapshot || memorySnapshot)?.warnings.join(" ")}</SystemNotice>}
      {visibleError && <div className="memory-error system-details-error" role="alert"><TriangleAlert size={17} aria-hidden="true" /><div><strong>{title} details unavailable</strong><p>{visibleError}</p><button type="button" className="small-primary" onClick={() => void refresh()}>Try again</button></div></div>}
      <MetricsHistoryChart metric={kind === "processor" ? "cpu" : "memory"} />

      <section className="process-card system-details-process-card">
        <div className="card-heading"><div><div className="section-title-row"><h3>Processes</h3>{snapshot && <span className="count-pill">{snapshot.returnedCount} / {snapshot.totalCount}</span>}</div><p>{kind === "processor" ? "CPU percentage is each process’s share of total system CPU." : "Resident set size is the physical RAM currently held by each process."}</p></div>{kind === "processor" ? <Cpu size={18} className="process-heading-icon" /> : <Database size={18} className="process-heading-icon" />}</div>
        {!snapshot && !error ? <div className="process-state" role="status" aria-live="polite"><RefreshCw size={20} className="spin" aria-hidden="true" /><span>Reading host processes…</span></div> : error && !snapshot ? <div className="process-state"><TriangleAlert size={20} aria-hidden="true" /><span>Metrics agent unavailable. Use Try again to retry.</span></div> : processes.length ? <ProcessTable kind={kind} title={title} processes={processes} sortKey={sortKey} descending={descending} sortLabels={sortLabels} changeSort={changeSort} /> : <div className="process-state"><Database size={20} aria-hidden="true" /><span>No readable processes were returned.</span></div>}
      </section>
      </>}
      <div className="system-details-footer"><span><span className="sync-dot" />Live · refreshes every 5 sec</span><span>Connected locally</span></div>
    </section>
  </motion.div>;
}

function StorageDetails({ overview, error, refreshing, onRefresh }: {
  overview: ServerOverview | null;
  error: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [selectedVolumeId, setSelectedVolumeId] = useState("nimbus");
  const volumes = overview?.storageVolumes ?? [];
  const selectedVolume = volumes.find((volume) => volume.id === selectedVolumeId) ?? null;
  const storageStats = getStorageVolumeStats(selectedVolume);
  const selectedVolumeMissing = !selectedVolume;
  const usedPercent = storageStats && storageStats.totalBytes > 0
    ? Number(((storageStats.usedBytes / storageStats.totalBytes) * 100).toFixed(1))
    : 0;

  return <section className="storage-details-content">
    <div className="storage-volume-picker">
      <label htmlFor="storage-volume-select">Storage volume</label>
      <select id="storage-volume-select" value={selectedVolumeId} onChange={(event) => setSelectedVolumeId(event.target.value)}>
        {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.label}</option>)}
        {selectedVolumeMissing && <option value={selectedVolumeId} disabled>{selectedVolumeId === "nimbus" ? "Nimbus unavailable" : "Selected disk unavailable"}</option>}
      </select>
    </div>

    {error && <div className="memory-error system-details-error" role="alert"><TriangleAlert size={17} aria-hidden="true" /><div><strong>Storage details may be out of date</strong><p>{error}</p><button type="button" className="small-primary" onClick={onRefresh}>{refreshing ? "Refreshing…" : "Try again"}</button></div></div>}
    {!overview && !error ? <div className="storage-details-state" role="status"><RefreshCw size={20} className="spin" aria-hidden="true" /><span>Reading mounted storage…</span></div>
      : storageStats ? <>
        <section className="memory-summary system-details-summary storage-details-summary">
          <SystemSummary className="storage-stat-used" label="Used" value={formatStorageBytes(storageStats.usedBytes)} detail={`${usedPercent}% of total`} tone="orange" icon={<HardDrive size={16} />} />
          <SystemSummary className="storage-stat-available" label="Available" value={formatStorageBytes(storageStats.availableBytes)} detail="Free to use" tone="green" icon={<HardDrive size={16} />} />
          <SystemSummary className="storage-stat-total" label="Total" value={formatStorageBytes(storageStats.totalBytes)} detail="Filesystem capacity" tone="blue" icon={<HardDrive size={16} />} />
        </section>
        <div className="storage-capacity-card">
          <div className="storage-capacity-heading"><span>Used / total</span><strong>{formatStorageBytes(storageStats.usedBytes)} / {formatStorageBytes(storageStats.totalBytes)}</strong></div>
          <div className="storage-capacity-track" role="progressbar" aria-label={`${storageStats.label} storage used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
            <span style={{ width: `${Math.min(100, Math.max(0, usedPercent))}%` }} />
          </div>
          {storageStats.reservedBytes > 0 && <p className="storage-reserved-note">{formatStorageBytes(storageStats.reservedBytes)} reserved for system use</p>}
        </div>
      </> : overview ? <div className="storage-details-state" role="status"><TriangleAlert size={20} aria-hidden="true" /><span>{selectedVolume ? `${selectedVolume.label} is mounted but its usage could not be read.` : "The selected volume is no longer available. Choose another mounted disk."}</span></div> : null}
    <p className="storage-details-note">Nimbus uses its database filesystem. Other disks appear here when explicitly mounted read-only for telemetry.</p>
  </section>;
}

function getStorageVolumeStats(volume: StorageVolume | null): (StorageVolume & {
  usedBytes: number;
  availableBytes: number;
  reservedBytes: number;
  totalBytes: number;
}) | null {
  if (!volume || volume.usedBytes === null || volume.availableBytes === null || volume.reservedBytes === null || volume.totalBytes === null) return null;
  return {
    ...volume,
    usedBytes: volume.usedBytes,
    availableBytes: volume.availableBytes,
    reservedBytes: volume.reservedBytes,
    totalBytes: volume.totalBytes,
  };
}

function ProcessTable({
  kind,
  title,
  processes,
  sortKey,
  descending,
  sortLabels,
  changeSort,
}: {
  kind: SystemDetailKind;
  title: string;
  processes: Array<CpuProcess | MemoryProcess>;
  sortKey: SortKey;
  descending: boolean;
  sortLabels: Partial<Record<SortKey, string>>;
  changeSort: (nextKey: SortKey) => void;
}) {
  return <div className="process-table-wrap"><table className={`process-table${kind === "processor" ? " processor-table" : ""}`}>
    <caption className="visually-hidden">{getProcessTableCaption(title, sortLabels[sortKey] ?? sortKey, descending ? "descending" : "ascending")}</caption>
    <thead><tr>{(Object.keys(sortLabels) as SortKey[]).map((key) => {
      const field = sortLabels[key] ?? key;
      const currentDirection = sortKey === key ? descending ? "descending" : "ascending" : null;
      const nextDirection = getNextProcessSortDirection({ label: field, numeric: key === "cpuPercent" || key === "rssBytes" || key === "memoryPercent" }, sortKey === key, descending);
      return <th key={key} aria-sort={sortKey === key ? (descending ? "descending" : "ascending") : "none"}><button type="button" onClick={() => changeSort(key)} aria-label={getProcessSortButtonLabel(field, currentDirection, nextDirection)}>{field}<ArrowUpDown size={13} aria-hidden="true" /></button></th>;
    })}</tr></thead>
    <tbody>{processes.map((process) => <tr key={process.pid}><td><strong>{process.name}</strong></td><td className="process-command" title={process.command}>{process.command}</td><td className="mono-cell">{process.pid}</td><td>{process.user}</td>{kind === "processor" && <td className="value-cell">{formatPercent((process as CpuProcess).cpuPercent)}</td>}<td className="value-cell">{formatBytes(process.rssBytes)}</td><td className="value-cell">{formatPercent(process.memoryPercent)}</td></tr>)}</tbody>
  </table></div>;
}

function SystemSummary({ label, value, detail, tone, icon, className = "" }: { label: string; value: string; detail: string; tone: string; icon: React.ReactNode; className?: string }) {
  return <div className={`memory-summary-card${className ? ` ${className}` : ""}`}><span className={`stat-icon ${tone}`}>{icon}</span><span className="memory-summary-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function SystemNotice({ tone, icon, title, children }: { tone: "info" | "warning"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className={`memory-${tone} system-details-notice`}>{icon}<div><strong>{title}</strong><p>{children}</p></div></div>;
}

function processSummaryDetail(snapshot: MemorySnapshot | ProcessorSnapshot) {
  const details = [`${snapshot.returnedCount} returned`];
  if (snapshot.unreadableCount) details.push(`${snapshot.unreadableCount} unavailable`);
  if (snapshot.policyOmittedCount) details.push(`${snapshot.policyOmittedCount} omitted by ${formatPolicyReason(snapshot.policyOmittedReason)}`);
  return details.join(" · ");
}

function formatPolicyReason(reason: MemorySnapshot["policyOmittedReason"]) {
  if (reason === "scan-limit") return "scan limit";
  if (reason === "scan-and-process-limit") return "scan and process limits";
  return "process limit";
}

function compareProcesses(left: CpuProcess | MemoryProcess, right: CpuProcess | MemoryProcess, key: SortKey, descending: boolean) {
  const leftValue = (left as unknown as Record<string, string | number>)[key];
  const rightValue = (right as unknown as Record<string, string | number>)[key];
  const comparison = typeof leftValue === "string" && typeof rightValue === "string" ? leftValue.localeCompare(rightValue) : Number(leftValue) - Number(rightValue);
  return descending ? -comparison : comparison;
}

function formatBytes(bytes: number, decimals?: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formattedValue = decimals === undefined
    ? value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)
    : value.toFixed(decimals);
  return `${formattedValue} ${units[unitIndex]}`;
}

function formatStorageBytes(bytes: number) {
  return formatBytes(bytes, bytes < 1024 ? 0 : 1);
}

function formatPercent(value: number) {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
