import type { AppSource, AppStatus, ManagedApp } from "./types";
import { stripLegacyFavoriteField } from "./app-payload.ts";

const appStatuses: AppStatus[] = ["online", "degraded", "offline", "unknown"];
const appSources: AppSource[] = ["manual", "docker"];
const containerStates = ["created", "restarting", "running", "removing", "paused", "exited", "dead", "unknown"];
const containerHealthStates = ["healthy", "unhealthy", "starting", "none", "unknown"];
const optionalStringFields = [
  "icon", "healthUrl", "dockerProject", "dockerService", "containerId", "containerName", "containerImage",
  "containerState", "containerHealth", "containerStartedAt", "containerObservedAt", "casaosHostname", "casaosPortMap", "casaosIndex",
] as const;

export function parseManagedAppPayload(value: unknown): ManagedApp | null {
  if (!isRecord(value)) return null;
  const source = value.source === undefined ? "manual" : value.source;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const icon = typeof value.icon === "string" ? value.icon.trim() : undefined;
  const healthUrl = typeof value.healthUrl === "string" ? value.healthUrl.trim() : undefined;
  if (
    !isNonEmptyString(value.id) || !isNonEmptyString(value.name) || typeof value.description !== "string"
    || !isNonEmptyString(value.category) || !isWebUrl(url) || !isHexColor(value.color)
    || !isOneOf(value.status, appStatuses) || !isOneOf(source, appSources)
    || typeof value.isVisible !== "boolean" || typeof value.sortOrder !== "number" || !Number.isInteger(value.sortOrder)
    || (value.allowInsecureTls !== undefined && typeof value.allowInsecureTls !== "boolean")
    || (value.casaosScheme !== undefined && value.casaosScheme !== "http" && value.casaosScheme !== "https")
    || optionalStringFields.some((field) => value[field] !== undefined && typeof value[field] !== "string")
    || (icon !== undefined && icon !== "" && !isWebUrl(icon))
    || (healthUrl !== undefined && healthUrl !== "" && !isWebUrl(healthUrl))
    || (value.containerState !== undefined && !containerStates.includes(String(value.containerState)))
    || (value.containerHealth !== undefined && !containerHealthStates.includes(String(value.containerHealth)))
  ) return null;

  const payload = stripLegacyFavoriteField(value);
  return {
    id: String(payload.id).trim(),
    name: String(payload.name).trim(),
    description: String(payload.description),
    category: String(payload.category).trim(),
    url,
    icon,
    color: String(payload.color).trim(),
    healthUrl,
    allowInsecureTls: payload.allowInsecureTls === true,
    status: payload.status as AppStatus,
    source,
    isVisible: Boolean(payload.isVisible),
    sortOrder: Number(payload.sortOrder),
    ...(payload.dockerProject === undefined ? {} : { dockerProject: payload.dockerProject }),
    ...(payload.dockerService === undefined ? {} : { dockerService: payload.dockerService }),
    ...(payload.containerId === undefined ? {} : { containerId: payload.containerId }),
    ...(payload.containerName === undefined ? {} : { containerName: payload.containerName }),
    ...(payload.containerImage === undefined ? {} : { containerImage: payload.containerImage }),
    ...(payload.containerState === undefined ? {} : { containerState: payload.containerState }),
    ...(payload.containerHealth === undefined ? {} : { containerHealth: payload.containerHealth }),
    ...(payload.containerStartedAt === undefined ? {} : { containerStartedAt: payload.containerStartedAt }),
    ...(payload.containerObservedAt === undefined ? {} : { containerObservedAt: payload.containerObservedAt }),
    ...(payload.casaosScheme === undefined ? {} : { casaosScheme: payload.casaosScheme }),
    ...(payload.casaosHostname === undefined ? {} : { casaosHostname: payload.casaosHostname }),
    ...(payload.casaosPortMap === undefined ? {} : { casaosPortMap: payload.casaosPortMap }),
    ...(payload.casaosIndex === undefined ? {} : { casaosIndex: payload.casaosIndex }),
  } as ManagedApp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function isOneOf<T extends string>(value: unknown, values: T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}
