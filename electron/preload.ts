import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("antiAfk", {
  detectWindows: () => ipcRenderer.invoke("minecraft:detect"),
  start: (config: StartConfig) => ipcRenderer.invoke("afk:start", config),
  stop: () => ipcRenderer.invoke("afk:stop"),
  pause: () => ipcRenderer.invoke("afk:pause"),
  getStatus: () => ipcRenderer.invoke("afk:status"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  getUpdateState: () => ipcRenderer.invoke("updates:state"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  openRepository: () => ipcRenderer.invoke("app:open-repository"),
  openTelegram: () => ipcRenderer.invoke("app:open-telegram"),
  getLogs: () => ipcRenderer.invoke("logs:list"),
  getPluginCatalog: () => ipcRenderer.invoke("plugins:catalog"),
  getPlugins: () => ipcRenderer.invoke("plugins:list"),
  installPlugin: (pluginId: string) => ipcRenderer.invoke("plugins:install", pluginId),
  setPluginEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke("plugins:set-enabled", pluginId, enabled),
  removePlugin: (pluginId: string) => ipcRenderer.invoke("plugins:remove", pluginId),
  closeOverlay: () => ipcRenderer.invoke("overlay:close"),
  showOverlay: () => ipcRenderer.invoke("overlay:show"),
  onStatus: (callback: (status: RuntimeStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RuntimeStatus) => callback(status);
    ipcRenderer.on("afk:status-changed", listener);
    return () => ipcRenderer.removeListener("afk:status-changed", listener);
  },
  onUpdate: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
  onLog: (callback: (entry: AppLogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: AppLogEntry) => callback(entry);
    ipcRenderer.on("logs:entry", listener);
    return () => ipcRenderer.removeListener("logs:entry", listener);
  }
});

export type MinecraftWindow = { id: string; title: string; processName: string; pid: number };
export type ActionName = "camera" | "jump" | "walk";
export type StartConfig = {
  target: MinecraftWindow;
  actions: ActionName[];
  intervalMs: number;
};
export type RuntimeStatus = {
  running: boolean;
  paused: boolean;
  message: string;
  lastActionAt: number | null;
  nextActionAt: number | null;
  intervalMs: number;
};
export type UpdateState = {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
  message: string;
  version?: string;
};
export type AppLogEntry = { timestamp: string; level: "info" | "warning" | "error"; message: string };
export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  actions: ActionName[];
};
export type InstalledPlugin = PluginManifest & { enabled: boolean };
export type CatalogPlugin = PluginManifest & { downloadUrl: string };

declare global {
  interface Window {
    antiAfk: {
      detectWindows: () => Promise<MinecraftWindow[]>;
      start: (config: StartConfig) => Promise<{ ok: boolean; message: string }>;
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
