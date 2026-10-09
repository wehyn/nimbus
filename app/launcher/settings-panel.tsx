import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Check, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { getAppUrlParts, isHostLocalService, updateAppUrl, type AppUrlProtocol } from "@/lib/app-url";
import { startActivityClock, formatRelativeTime } from "@/lib/relative-time";
import type { ActivityEvent, ManagedApp } from "@/lib/types";
import { AppIcon } from "./icons";
import { ActivityRow } from "./activity";
import { statusCopy, blankApp } from "./utils";
import { getFocusableElements } from "@/app/modal-focus.tsx";
import { nextAppSortOrder } from "@/lib/app-order";

const motionTransition = { duration: 0.2, ease: "easeOut" as const };

type SettingsPanelProps = {
  apps: ManagedApp[];
  activities: ActivityEvent[];
  editing: ManagedApp | null;
  deletingId: string | null;
  saving: boolean;
  mutationError: string;
  onRefreshActivity: () => void;
  onClose: () => void;
  onEdit: (app: ManagedApp | null) => void;
  onSave: (app: ManagedApp) => void;
  onDelete: (id: string) => void;
};

function appFieldId(appId: string, field: string) {
  return `app-${appId}-${field}`;
}

export const SettingsPanel = memo(function SettingsPanel({ apps, activities, editing, deletingId, saving, mutationError, onRefreshActivity, onClose, onEdit, onSave, onDelete }: SettingsPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (editingRef.current) onEdit(null);
        else onClose();
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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onEdit]);

  return <section ref={panelRef} className={`settings-panel${editing ? " details-panel" : ""}`} role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
    <div className="panel-header"><div><p className="eyebrow">Workspace</p><h2 id="settings-title">{editing ? "Application details" : "Application management"}</h2></div><button type="button" ref={closeButtonRef} className="close-button" onClick={onClose} aria-label="Close application modal"><X size={19} aria-hidden="true" /></button></div>
    <AnimatePresence mode="wait" initial={false}>
      {editing
        ? <motion.div key={`form-${editing.id}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={motionTransition}><AppForm app={editing} isNew={!apps.some((app) => app.id === editing.id)} saving={saving} onCancel={() => onEdit(null)} onSave={onSave} onDelete={onDelete} /></motion.div>
        : <motion.div key="application-list" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={motionTransition}>
          <div className="panel-section"><div className="panel-section-heading"><div><h3>Applications</h3><p>Manage what appears on your home screen.</p></div><button type="button" className="small-primary" onClick={() => onEdit(blankApp(nextAppSortOrder(apps)))}><Plus size={15} aria-hidden="true" />Add</button></div>
            <div className="settings-list"><AnimatePresence initial={false} mode="popLayout">{apps.map((app) => <motion.div className="settings-app" key={app.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, x: 8 }} transition={motionTransition}><AppIcon app={app} /><div><strong>{app.name}</strong><small>{app.category} · {statusCopy[app.status]}</small></div><button type="button" className="edit-button" disabled={deletingId === app.id} onClick={() => onEdit(app)} aria-label={`Edit ${app.name}`}><Pencil size={15} aria-hidden="true" /></button></motion.div>)}</AnimatePresence></div>
          </div>
          <SettingsActivity activities={activities} onRefreshActivity={onRefreshActivity} />
          <div className="panel-section settings-note"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Local-first by default</strong><p>Your app registry is stored on this server. No account or cloud sync required.</p></div></div>
        </motion.div>}
    </AnimatePresence>
    {mutationError && <p className="panel-error" role="alert">{mutationError}</p>}
  </section>;
});

function SettingsActivity({ activities, onRefreshActivity }: { activities: ActivityEvent[]; onRefreshActivity: () => void }) {
  const [activityNow, setActivityNow] = useState(() => Date.now());
  useEffect(() => startActivityClock(() => setActivityNow(Date.now())), []);

  return <div className="panel-section"><div className="panel-section-heading"><div><h3>Recent activity</h3><p>App changes and health events.</p></div>{activities.length > 0 && <button type="button" className="more-button" onClick={onRefreshActivity} aria-label="Refresh recent activity"><RefreshCw size={15} aria-hidden="true" /></button>}</div>{activities.length ? <div className="settings-activity">{activities.map((activity) => <ActivityRow key={activity.id} activity={activity} now={activityNow} />)}</div> : <div className="activity-empty"><Activity size={20} aria-hidden="true" /><strong>No recent activity</strong><small>App changes and health events will appear here.</small></div>}</div>;
}

function AppForm({ app, isNew, saving, onCancel, onSave, onDelete }: { app: ManagedApp; isNew: boolean; saving: boolean; onCancel: () => void; onSave: (app: ManagedApp) => void; onDelete: (id: string) => void }) {
  const [form, setForm] = useState(app);
  const [currentHost, setCurrentHost] = useState(() => getAppUrlParts(app.url)?.host || "");
  const urlParts = getAppUrlParts(form.url);
  const hostLocalService = isHostLocalService(form);
  const automaticHost = currentHost || urlParts?.host || "";
  const titleId = appFieldId(form.id, "title");
  const urlId = appFieldId(form.id, "url");
  const descriptionId = appFieldId(form.id, "description");
  const iconId = appFieldId(form.id, "icon");
  const healthUrlId = appFieldId(form.id, "health-url");
  const projectId = appFieldId(form.id, "compose-project");
  const serviceId = appFieldId(form.id, "compose-service");
  const tlsId = appFieldId(form.id, "tls");
  const visibilityId = appFieldId(form.id, "visibility");
  const update = (key: keyof ManagedApp, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const updateWebUi = (protocol: AppUrlProtocol, port: string) => {
    if (!automaticHost) return;
    update("url", updateAppUrl(form.url, protocol, automaticHost, port));
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedForm = hostLocalService && automaticHost
      ? { ...form, url: updateAppUrl(form.url, urlParts?.protocol || "http", automaticHost, urlParts?.port || "") }
      : form;
    onSave(savedForm);
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${form.name || "this application"}? This cannot be undone.`)) return;
    onDelete(form.id);
    onCancel();
  }

  useEffect(() => {
    setForm(app);
    setCurrentHost(window.location.hostname);
  }, [app.id]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      containerId: app.containerId,
      containerName: app.containerName,
      containerImage: app.containerImage,
      containerState: app.containerState,
      containerHealth: app.containerHealth,
      containerStartedAt: app.containerStartedAt,
      containerObservedAt: app.containerObservedAt,
      casaosScheme: app.casaosScheme,
      casaosHostname: app.casaosHostname,
      casaosPortMap: app.casaosPortMap,
      casaosIndex: app.casaosIndex,
      dockerDetails: app.dockerDetails,
    }));
  }, [app]);

  return <form className="app-form" onSubmit={handleSubmit}>
    <button type="button" className="back-button" onClick={onCancel}>← <span>All applications</span></button>
    <div className="form-title"><AppIcon app={form} large /><div><p className="eyebrow">{isNew ? "New service" : "Edit service"}</p><h3>{isNew ? "Add application" : form.name}</h3></div></div>
    <label htmlFor={titleId}>Title<input id={titleId} required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="My application" /></label>
    {hostLocalService ? <div className="web-ui-editor"><div className="web-ui-fields"><label htmlFor={`${urlId}-protocol`}>Protocol<select id={`${urlId}-protocol`} value={urlParts?.protocol || "http"} onChange={(event) => updateWebUi(event.target.value as AppUrlProtocol, urlParts?.port || "")}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label><label className="web-ui-host" htmlFor={`${urlId}-host`}>IP<input id={`${urlId}-host`} value={automaticHost} readOnly aria-readonly="true" /></label><label htmlFor={`${urlId}-port`}>Port<input id={`${urlId}-port`} required type="number" min="1" max="65535" inputMode="numeric" value={urlParts?.port || ""} onChange={(event) => updateWebUi(urlParts?.protocol || "http", event.target.value)} /></label></div></div> : <div className="web-ui-editor"><label className="visually-hidden" htmlFor={urlId}>Application URL</label><input id={urlId} required type="url" value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://app.local" /></div>}
    <label htmlFor={descriptionId}>Description<input id={descriptionId} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="What is this for?" /></label>
    <label htmlFor={iconId}>Icon URL <span className="optional">optional</span><input id={iconId} type="url" value={form.icon || ""} onChange={(event) => update("icon", event.target.value)} placeholder="Leave blank to use app favicon" /></label>
    <label htmlFor={healthUrlId}>Health URL <span className="optional">optional</span><input id={healthUrlId} type="url" value={form.healthUrl || ""} onChange={(event) => update("healthUrl", event.target.value)} placeholder="https://.../health" /></label>
    <div className="form-columns form-columns-equal"><label htmlFor={projectId}>Compose project <span className="optional">optional</span><input id={projectId} value={form.dockerProject || ""} onChange={(event) => update("dockerProject", event.target.value)} placeholder="project-name" /></label><label htmlFor={serviceId}>Compose service <span className="optional">optional</span><input id={serviceId} value={form.dockerService || ""} onChange={(event) => update("dockerService", event.target.value)} placeholder="service-name" /></label></div>
    <DockerDetails app={form} />
    <div className="toggle-row"><div><label htmlFor={visibilityId}><strong>Show on launcher</strong></label><small id={`${visibilityId}-description`}>Keep this application in management while hiding it from your home screen.</small></div><button id={visibilityId} type="button" className={`toggle ${form.isVisible ? "toggle-on" : ""}`} onClick={() => update("isVisible", !form.isVisible)} aria-label="Show on launcher" aria-describedby={`${visibilityId}-description`} aria-pressed={form.isVisible}><span /></button></div>
    <div className="toggle-row"><div><label htmlFor={tlsId}><strong>Allow self-signed TLS</strong></label><small id={`${tlsId}-description`}>Health checks and favicon fetching; use for trusted private services.</small></div><button id={tlsId} type="button" className={`toggle ${form.allowInsecureTls ? "toggle-on" : ""}`} onClick={() => update("allowInsecureTls", !form.allowInsecureTls)} aria-label="Allow self-signed TLS" aria-describedby={`${tlsId}-description`} aria-pressed={form.allowInsecureTls}><span /></button></div>
    <div className="form-actions"><button type="button" className="button subtle" onClick={onCancel} disabled={saving}>Cancel</button>{!isNew && <button type="button" className="delete-button" onClick={handleDelete} disabled={saving}><Trash2 size={15} aria-hidden="true" />Delete</button>}<button type="submit" className="button primary" disabled={saving}><Check size={16} aria-hidden="true" />{saving ? "Saving…" : "Save changes"}</button></div>
  </form>;
}

function DockerDetails({ app }: { app: ManagedApp }) {
  const details = app.dockerDetails;
  const hasDockerLink = Boolean(details || app.source === "docker" || app.dockerProject || app.dockerService || app.containerId || app.containerName || app.containerImage);
  const image = details?.image || app.containerImage || "Not reported";
  const networks = details ? (details.networks.length ? details.networks.join(", ") : "No networks reported") : hasDockerLink ? "Awaiting Docker discovery" : "Not linked";
  const empty = hasDockerLink ? "Docker discovery is unavailable" : "No Docker metadata";

  return <section className="docker-details" aria-label="Container metadata">
    {!hasDockerLink && <div className="docker-details-empty"><strong>No Docker or Compose metadata</strong><p>Add a Compose project and service above to connect this application to its read-only service details.</p></div>}
    <div className="docker-metadata-grid"><MetadataItem label="Docker image tag" value={image} mono /><MetadataItem label="Network" value={networks} />{app.containerState && <MetadataItem label="Container status" value={app.containerState} />}</div>
    <DockerMetadataList label="Ports" empty={details ? "No declared ports" : empty} items={details ? formatDockerPorts(details.ports) : undefined} />
    <DockerMetadataList label="Volumes" empty={details ? "No mounted volumes" : empty} items={details?.volumes.map(formatDockerVolume)} />
    <DockerMetadataList label="Environment variables" empty={details ? "No environment variables reported" : empty} items={details?.environment.map((variable) => `${variable.name}=${variable.value}`)} mono />
  </section>;
}

function MetadataItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="docker-metadata-item"><span>{label}</span><strong className={mono ? "docker-mono" : ""}>{value}</strong></div>;
}

function DockerMetadataList({ label, empty, items, mono = false }: { label: string; empty: string; items?: string[]; mono?: boolean }) {
  return <div className="docker-metadata-list"><span>{label}</span>{items?.length ? <ul>{items.map((item, index) => <li key={`${label}-${index}`} className={mono ? "docker-mono" : ""}>{item}</li>)}</ul> : <strong>{empty}</strong>}</div>;
}

function formatDockerPorts(ports: NonNullable<ManagedApp["dockerDetails"]>["ports"]) {
  const groups: NonNullable<ManagedApp["dockerDetails"]>["ports"][] = [];
  for (const port of ports) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (previous && canJoinPortRange(previous, port)) current.push(port);
    else groups.push([port]);
  }
  return groups.map(formatDockerPortRange);
}

function canJoinPortRange(previous: NonNullable<ManagedApp["dockerDetails"]>["ports"][number], next: NonNullable<ManagedApp["dockerDetails"]>["ports"][number]) {
  if (previous.protocol !== next.protocol || previous.hostIp !== next.hostIp || next.containerPort !== previous.containerPort + 1) return false;
  if (previous.hostPort === null || next.hostPort === null) return previous.hostPort === null && next.hostPort === null;
  return next.hostPort === previous.hostPort + 1;
}

function formatDockerPortRange(ports: NonNullable<ManagedApp["dockerDetails"]>["ports"]) {
  const first = ports[0];
  const last = ports[ports.length - 1];
  const host = first.hostPort === null ? "container-only" : `${first.hostIp && first.hostIp !== "0.0.0.0" ? `${first.hostIp}:` : ""}${formatPortRange(first.hostPort, last.hostPort ?? first.hostPort)}`;
  return `${host} → ${formatPortRange(first.containerPort, last.containerPort)}/${first.protocol}`;
}

function formatPortRange(first: number, last: number) {
  return first === last ? `${first}` : `${first}–${last}`;
}

function formatDockerVolume(volume: NonNullable<ManagedApp["dockerDetails"]>["volumes"][number]) {
  return `${volume.type} · ${volume.source || "anonymous"} → ${volume.target}${volume.mode ? ` (${volume.mode})` : ""}`;
}
