import { notFound } from "next/navigation";
import { decodeAppRouteId } from "@/lib/app-url";
import { listApps } from "@/lib/db";
import type { ManagedApp } from "@/lib/types";
import AppViewer from "./app-viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LaunchApp = Pick<ManagedApp, "id" | "name" | "url" | "containerId" | "dockerProject" | "dockerService">;

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: routeId } = await params;
  if (!routeId.startsWith("app-")) notFound();
  const id = decodeAppRouteId(routeId.slice("app-".length));
  if (!id) notFound();
  const app = listApps().find((candidate) => candidate.id === id);
  if (!app) notFound();

  const launchApp: LaunchApp = {
    id: app.id,
    name: app.name,
    url: app.url,
    containerId: app.containerId,
    dockerProject: app.dockerProject,
    dockerService: app.dockerService,
  };

  return <AppViewer app={launchApp} />;
}
