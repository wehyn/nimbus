import type { DockerEnvironmentVariable, DockerPort, DockerVolume } from "@/agent/docker-discovery-types";

export type AppStatus = "online" | "degraded" | "offline" | "unknown";
export type AppSource = "manual" | "docker";
export type ActivityType = "app-created" | "app-updated" | "app-deleted" | "status-changed";
export type DockerContainerState = "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead" | "unknown";
export type DockerHealthState = "healthy" | "unhealthy" | "starting" | "none" | "unknown";
export type CasaOSScheme = "http" | "https";

export type DockerAppDetails = {
  source: "container" | "compose";
  image: string | null;
  networks: string[];
  ports: DockerPort[];
  volumes: DockerVolume[];
  environment: DockerEnvironmentVariable[];
};

export type ManagedApp = {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  icon?: string;
  color: string;
  healthUrl?: string;
  allowInsecureTls?: boolean;
  status: AppStatus;
  source: AppSource;
  isVisible: boolean;
  sortOrder: number;
  dockerProject?: string;
  dockerService?: string;
  containerId?: string;
  containerName?: string;
  containerImage?: string;
  containerState?: DockerContainerState;
  containerHealth?: DockerHealthState;
  containerStartedAt?: string;
  containerObservedAt?: string;
  casaosScheme?: CasaOSScheme;
  casaosHostname?: string;
  casaosPortMap?: string;
  casaosIndex?: string;
  /** Live or Compose-derived Docker metadata; intentionally not persisted in SQLite. */
  dockerDetails?: DockerAppDetails;
};

export type ActivityEvent = {
  id: number;
  type: ActivityType;
  appId?: string;
  appName: string;
  status?: AppStatus;
  createdAt: string;
};

export type ServerOverview = {
  uptime: string;
  cpu: number;
  cpuCores: number;
  temperatureC: number | null;
  powerWatts: number | null;
  powerSource: "intel-rapl" | null;
  memory: number;
  memoryUsed: string;
  memoryTotal: string;
  storage: number;
  storageUsed: string;
  storageAvailable: string;
  storageTotal: string;
  downloadBytesPerSecond: number | null;
  uploadBytesPerSecond: number | null;
  storageVolumes: StorageVolume[];
  updatedAt: string;
};

export type StorageVolume = {
  id: string;
  label: string;
  usedBytes: number | null;
  availableBytes: number | null;
  reservedBytes: number | null;
  totalBytes: number | null;
};

export type HistoricalMetric = {
  timestamp: string;
  cpu: number;
  memory: number;
  storage: number;
  temperatureC: number | null;
  powerWatts: number | null;
};

export type MemoryProcess = {
  pid: number;
  name: string;
  command: string;
  user: string;
  rssBytes: number;
  memoryPercent: number;
};

export type MemorySnapshot = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  processes: MemoryProcess[];
  totalCount: number;
  returnedCount: number;
  unreadableCount: number;
  policyOmittedCount: number;
  policyOmittedReason: "process-limit" | "scan-limit" | "scan-and-process-limit" | null;
  partial: boolean;
  omittedCount: number;
  warnings: string[];
  updatedAt: string;
};

export type CpuProcess = MemoryProcess & {
  cpuPercent: number;
};

export type ProcessorSnapshot = {
  cpuPercent: number;
  cpuCores: number;
  loadAverage: {
    one: number;
    five: number;
    fifteen: number;
  };
  processes: CpuProcess[];
  totalCount: number;
  returnedCount: number;
  unreadableCount: number;
  policyOmittedCount: number;
  policyOmittedReason: "process-limit" | "scan-limit" | "scan-and-process-limit" | null;
  sampling: boolean;
  partial: boolean;
  omittedCount: number;
  warnings: string[];
  updatedAt: string;
};
