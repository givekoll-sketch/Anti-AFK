export {};

type MinecraftWindow = { id: string; title: string; processName: string; pid: number };
type ActionName = "camera" | "jump" | "walk";
type RuntimeStatus = {
  running: boolean;
  paused: boolean;
  message: string;
  lastActionAt: number | null;
};
type UpdateState = { status: string; message: string; version?: string };

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
      downloadUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
      openRepository: () => Promise<void>;
      onStatus: (callback: (status: RuntimeStatus) => void) => () => void;
      onUpdate: (callback: (state: UpdateState) => void) => () => void;
    };
  }
}
