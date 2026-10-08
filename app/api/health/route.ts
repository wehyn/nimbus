import { NextResponse } from "next/server";
import { findApp, getHealthPersistenceSnapshot, updateAppStatusIfHealthSnapshotMatches } from "@/lib/db";
import { isCasaOSHealthSuccess, resolveHealthTarget } from "@/lib/health-target";
import { requestWithInsecureTls } from "@/lib/insecure-tls-request";
import type { AppStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appId = requestUrl.searchParams.get("id");
  if (!appId) return NextResponse.json({ status: "unknown", error: "id is required" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  const app = findApp(appId);
  if (!app) return NextResponse.json({ status: "unknown", error: "application not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const url = resolveHealthTarget(app);
  if (!url) return NextResponse.json({ status: "unknown" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  const persistenceSnapshot = getHealthPersistenceSnapshot(appId, url);

  try {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Unsupported target");
    const allowInsecureTls = app.allowInsecureTls === true;
    const started = Date.now();
    const response = allowInsecureTls && target.protocol === "https:"
      ? await requestWithInsecureTls(target, request.signal)
      : await fetchWithTimeout(target, request.signal);
    const elapsed = Date.now() - started;
    const successful = isCasaOSHealthSuccess(response.statusCode);
    const status = (successful ? (elapsed > 1800 ? "degraded" : "online") : "degraded") as AppStatus;
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (persistenceSnapshot) updateAppStatusIfHealthSnapshotMatches(appId, status, persistenceSnapshot);
    return NextResponse.json({ status, latency: elapsed, statusCode: response.statusCode }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (persistenceSnapshot) updateAppStatusIfHealthSnapshotMatches(appId, "offline", persistenceSnapshot);
    return NextResponse.json({ status: "offline" }, { headers: { "Cache-Control": "private, no-store" } });
  }
}

async function fetchWithTimeout(target: URL, requestSignal: AbortSignal) {
  if (requestSignal.aborted) throw new Error("Health check aborted");
  const controller = new AbortController();
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(target, { method: "GET", cache: "no-store", redirect: "manual", signal: controller.signal });
    await response.body?.cancel().catch(() => undefined);
    return { statusCode: response.status };
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", abort);
  }
}
