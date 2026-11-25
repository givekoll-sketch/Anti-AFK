export {};

type MinecraftWindow = { id: string; title: string; processName: string; pid: number };
type ActionName = "camera" | "jump" | "walk";
type RuntimeStatus = {
  running: boolean;
  paused: boolean;
  message: string;
  lastActionAt: number | null;
  nextActionAt: number | null;
  intervalMs: number;
};
type UpdateState = {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
  message: string;
  version?: string;
};
type AppLogEntry = { timestamp: string; level: "info" | "warning" | "error"; message: string };
type PluginManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  actions: ActionName[];
};
type InstalledPlugin = PluginManifest & { enabled: boolean };
type CatalogPlugin = PluginManifest & { downloadUrl: string };

declare global {
  interface Window {
    antiAfk: {
      detectWindows: () => Promise<MinecraftWindow[]>;
      start: (config: { target: MinecraftWindow; actions: ActionName[]; intervalMs: number }) => Promise<{ ok: boolean; message: string }>;
      stop: () => Promise<void>;
      pause: () => Promise<void>;
      getStatus: () => Promise<RuntimeStatus>;
      saveSettings: (settings: unknown) => Promise<void>;
      loadSettings: () => Promise<any>;
      checkUpdates: () => Promise<void>;
      getUpdateState: () => Promise<UpdateState>;
      downloadUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
      openRepository: () => Promise<void>;
      openTelegram: () => Promise<void>;
      getLogs: () => Promise<AppLogEntry[]>;
      getPluginCatalog: () => Promise<{ plugins: CatalogPlugin[]; installed: InstalledPlugin[]; warning?: string }>;
      getPlugins: () => Promise<InstalledPlugin[]>;
      installPlugin: (pluginId: string) => Promise<InstalledPlugin[]>;
      setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<InstalledPlugin[]>;
      removePlugin: (pluginId: string) => Promise<InstalledPlugin[]>;
      closeOverlay: () => Promise<void>;
      showOverlay: () => Promise<void>;
      onStatus: (callback: (status: RuntimeStatus) => void) => () => void;
      onUpdate: (callback: (state: UpdateState) => void) => () => void;
      onLog: (callback: (entry: AppLogEntry) => void) => () => void;
    };
  }
}
