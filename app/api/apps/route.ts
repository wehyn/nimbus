import { NextResponse } from "next/server";
import { listApps, reconcileDockerApps, removeApp, reorderApps, saveApp } from "@/lib/db";
import { fetchDockerDiscovery } from "@/lib/docker-discovery";
import { resolveDockerDetails } from "@/lib/docker-details";
import { parseManagedAppPayload } from "@/lib/app-validation";
import type { ManagedApp } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCOVERY_BUDGET_MS = 750;

export async function GET() {
  const discoveryPromise = fetchDockerDiscovery();
  let timeoutResolve: (value: null) => void = () => undefined;
  const timeoutPromise = new Promise<null>((resolve) => { timeoutResolve = resolve; });
  const timer = setTimeout(() => timeoutResolve(null), DISCOVERY_BUDGET_MS);
  discoveryPromise.then(() => clearTimeout(timer), () => clearTimeout(timer));
  const discovery = await Promise.race([discoveryPromise, timeoutPromise]);
  void discoveryPromise.then((resolved) => {
    if (resolved.available) reconcileDockerApps(resolved.containers, { preserveUnmatched: resolved.status === "partial" });
  }).catch(() => undefined);
  const docker = discovery || {
    available: false,
    status: "unavailable" as const,
    warnings: ["Docker discovery is still loading."],
    updatedAt: new Date().toISOString(),
    containers: [],
    composeServices: [],
  };
  const reconciledApps = docker.available
    ? reconcileDockerApps(docker.containers, { preserveUnmatched: docker.status === "partial" })
    : listApps();
  const apps = reconciledApps.map((app) => {
    const dockerDetails = resolveDockerDetails(app, docker.containers, docker.composeServices || []);
    return dockerDetails ? { ...app, dockerDetails } : app;
  });
  return NextResponse.json({
    apps,
    docker: {
      available: docker.available,
      status: docker.status,
      warnings: docker.warnings,
      updatedAt: docker.updatedAt,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const app = parseManagedAppPayload(await readJson(request));
  if (!app) return NextResponse.json({ error: "invalid application payload" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  const { dockerDetails: _dockerDetails, ...persistedApp } = app;
  return NextResponse.json({ app: saveApp({ ...persistedApp, allowInsecureTls: app.allowInsecureTls === true, source: app.source || "manual" }) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const payload = await readJson(request);
  if (!isRecord(payload) || !Array.isArray(payload.orderedIds)) {
    return NextResponse.json({ error: "orderedIds must contain every application id once" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  const currentIds = new Set(listApps().map((app) => app.id));
  if (payload.orderedIds.length !== currentIds.size || !payload.orderedIds.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json({ error: "orderedIds must contain every application id once" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  const orderedIds = payload.orderedIds as string[];
  const requestedIds = new Set(orderedIds);
  if (requestedIds.size !== orderedIds.length || requestedIds.size !== currentIds.size || [...currentIds].some((id) => !requestedIds.has(id))) {
    return NextResponse.json({ error: "orderedIds must contain every application id once" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  if (!reorderApps(orderedIds)) return NextResponse.json({ error: "application list changed; reload and retry" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ ok: true, orderedIds: listApps().map((app) => app.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  const payload = await readJson(request);
  const id = isRecord(payload) && typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  removeApp(id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
