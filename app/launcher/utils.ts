import type { AppStatus, ManagedApp } from "@/lib/types";

export const statusCopy: Record<AppStatus, string> = {
  online: "Online",
  degraded: "Slow response",
  offline: "Offline",
  unknown: "Not checked",
};

export function blankApp(order: number): ManagedApp {
  return {
    id: `app-${Date.now()}`,
    name: "",
    description: "",
    category: "Productivity",
    url: "",
    icon: "",
    color: "#a8cf8d",
    healthUrl: "",
    allowInsecureTls: false,
    status: "unknown",
    source: "manual",
    isVisible: true,
    sortOrder: order,
  };
}

export function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

export function formatTemperature(value: number | null) {
  return value === null ? "Unavailable" : `${value}°C`;
}

export function formatPower(value: number | null) {
  return value === null ? "Unavailable" : `${value.toFixed(2)} W`;
}

export function formatNetworkRate(bytesPerSecond: number | null) {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return "—";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function isAppStatus(value: unknown): value is AppStatus {
  return value === "online" || value === "degraded" || value === "offline" || value === "unknown";
}
