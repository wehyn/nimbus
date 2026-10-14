import type { ManagedApp } from "./types";

export type AppUrlProtocol = "http" | "https";

export function encodeAppRouteId(appId: string) {
  let encoded = "";
  for (let index = 0; index < appId.length; index++) encoded += appId.charCodeAt(index).toString(16).padStart(4, "0");
  return encoded;
}

export function decodeAppRouteId(encoded: string) {
  if (!encoded || encoded.length % 4 !== 0 || !/^[0-9a-f]+$/.test(encoded)) return undefined;
  let appId = "";
  for (let index = 0; index < encoded.length; index += 4) appId += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16));
  return appId;
}

export function isHostLocalService(app: Pick<ManagedApp, "dockerDetails" | "containerId" | "dockerProject" | "dockerService">) {
  return Boolean(app.dockerDetails || app.containerId || app.dockerProject || app.dockerService);
}

export function getAppUrlParts(url: string) {
  try {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol)) return undefined;
    const protocol = target.protocol === "https:" ? "https" : "http";
    return {
      protocol: protocol as AppUrlProtocol,
      host: target.hostname,
      port: target.port || (protocol === "https" ? "443" : "80"),
    };
  } catch {
    return undefined;
  }
}

export function updateAppUrl(url: string, protocol: AppUrlProtocol, host: string, port: string) {
  if (!host.trim()) return url;
  try {
    const target = new URL(url || `${protocol}://${host.trim()}`);
    target.protocol = `${protocol}:`;
    target.hostname = host.trim();
    target.port = port.trim();
    return target.href;
  } catch {
    return url;
  }
}

export function resolveAppLaunchUrl(app: Pick<ManagedApp, "url" | "dockerDetails" | "containerId" | "dockerProject" | "dockerService">, currentHost?: string) {
  const host = currentHost?.trim();
  if (!host || !isHostLocalService(app)) return app.url;

  try {
    const target = new URL(app.url);
    if (!["http:", "https:"].includes(target.protocol) || target.hostname === host) return app.url;
    target.hostname = host;
    return target.href;
  } catch {
    return app.url;
  }
}
