import { app, BrowserWindow, ipcMain, globalShortcut, shell, screen } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let runtime = {
  running: false,
  paused: false,
  message: "Ожидание запуска",
  lastActionAt: null as number | null,
  nextActionAt: null as number | null,
  intervalMs: 300000
};
let activeConfig: any = null;
let settingsPath = "";
type UpdateStatus = "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
type UpdateState = { status: UpdateStatus; message: string; version?: string };
type LogLevel = "info" | "warning" | "error";
type AppLogEntry = { timestamp: string; level: LogLevel; message: string };
type ActionName = "camera" | "jump" | "walk";
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
let updateState: UpdateState = { status: "idle", message: "Проверка обновлений ещё не выполнялась" };
let logPath = "";
let pluginDirectory = "";
let lastFocusWarningAt = 0;
let lastActionErrorAt = 0;
type ActionAttempt = "performed" | "unfocused" | "error" | "inactive";
const pluginCatalogUrl = "https://raw.githubusercontent.com/givekoll-sketch/Anti-AFK/main/plugins/catalog.json";
const pluginPackagePrefix = "https://raw.githubusercontent.com/givekoll-sketch/Anti-AFK/main/plugins/packages/";
const allowedActions = new Set<ActionName>(["camera", "jump", "walk"]);

function writeLog(level: LogLevel, message: string) {
  const entry: AppLogEntry = { timestamp: new Date().toISOString(), level, message };
  if (!logPath) {
    console[level === "error" ? "error" : level === "warning" ? "warn" : "log"](message);
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      const recentLines = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).slice(-500);
      fs.writeFileSync(logPath, recentLines.length ? `${recentLines.join("\n")}\n` : "", "utf8");
    }
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    mainWindow?.webContents.send("logs:entry", entry);
  } catch (error) {
    console.error("Не удалось записать журнал приложения:", error);
  }
}

function readLogs(): AppLogEntry[] {
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-500)
    .map(line => JSON.parse(line) as AppLogEntry)
    .reverse();
}

function publishStatus() {
  mainWindow?.webContents.send("afk:status-changed", runtime);
  overlayWindow?.webContents.send("afk:status-changed", runtime);
}

function publishUpdate(status: UpdateStatus, message: string, version?: string) {
  updateState = { status, message, version };
  mainWindow?.webContents.send("updates:state", updateState);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isPluginManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== "object") return false;
  const plugin = value as Record<string, unknown>;
  return typeof plugin.id === "string" && /^[a-z0-9][a-z0-9-]{1,39}$/.test(plugin.id) &&
    typeof plugin.name === "string" && plugin.name.length <= 60 &&
    typeof plugin.version === "string" && /^\d+\.\d+\.\d+$/.test(plugin.version) &&
    typeof plugin.author === "string" && plugin.author.length <= 60 &&
    typeof plugin.description === "string" && plugin.description.length <= 500 &&
    Array.isArray(plugin.actions) && plugin.actions.length > 0 &&
    plugin.actions.every(action => typeof action === "string" && allowedActions.has(action as ActionName));
}

function isCatalogPlugin(value: unknown): value is CatalogPlugin {
  return isPluginManifest(value) && typeof (value as CatalogPlugin).downloadUrl === "string" &&
    (value as CatalogPlugin).downloadUrl.startsWith(pluginPackagePrefix) &&
    (value as CatalogPlugin).downloadUrl.endsWith(".json");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status} при загрузке каталога плагинов`);
  const body = await response.text();
  if (body.length > 512 * 1024) throw new Error("Ответ каталога плагинов превышает 512 КБ");
  return JSON.parse(body);
}

function listInstalledPlugins(): InstalledPlugin[] {
  fs.mkdirSync(pluginDirectory, { recursive: true });
  const plugins: InstalledPlugin[] = [];
  for (const file of fs.readdirSync(pluginDirectory)) {
    if (!/^[a-z0-9][a-z0-9-]{1,39}\.json$/.test(file)) continue;
    const filePath = path.join(pluginDirectory, file);
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!saved || typeof saved !== "object") throw new Error("Неверный формат записи плагина");
      const entry = saved as Record<string, unknown>;
      if (!isPluginManifest(entry.manifest) || entry.manifest.id !== file.slice(0, -5) || typeof entry.enabled !== "boolean") {
        throw new Error("Манифест плагина не прошёл проверку");
      }
      plugins.push({ ...entry.manifest, enabled: entry.enabled });
    } catch (error) {
      writeLog("error", `Не удалось прочитать плагин ${file}: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

function getEnabledPluginActions(): ActionName[] {
  return listInstalledPlugins().filter(plugin => plugin.enabled).flatMap(plugin => plugin.actions);
}

async function loadPluginCatalog(): Promise<{ plugins: CatalogPlugin[]; warning?: string }> {
  try {
    const response = await fetchJson(pluginCatalogUrl);
    if (!response || typeof response !== "object" || !Array.isArray((response as { plugins?: unknown }).plugins)) {
      throw new Error("Каталог плагинов имеет неверный формат");
    }
    const plugins = (response as { plugins: unknown[] }).plugins;
    if (!plugins.every(isCatalogPlugin)) throw new Error("Каталог содержит некорректный манифест");
    return { plugins, warning: "" };
  } catch (error) {
    writeLog("warning", `Не удалось обновить каталог плагинов: ${getErrorMessage(error)}`);
    const fallbackPath = path.join(app.getAppPath(), "plugins", "catalog.json");
    try {
      const fallback = JSON.parse(fs.readFileSync(fallbackPath, "utf8")) as { plugins?: unknown };
      if (!Array.isArray(fallback.plugins) || !fallback.plugins.every(isCatalogPlugin)) {
        throw new Error("Локальный каталог плагинов имеет неверный формат");
      }
      return {
        plugins: fallback.plugins,
        warning: "Не удалось подключиться к сети; показан встроенный каталог"
      };
    } catch (fallbackError) {
      writeLog("error", `Не удалось загрузить встроенный каталог плагинов: ${getErrorMessage(fallbackError)}`);
      throw fallbackError;
    }
  }
}

async function installPlugin(pluginId: string): Promise<InstalledPlugin[]> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(pluginId)) throw new Error("Некорректный идентификатор плагина");
  const catalog = await loadPluginCatalog();
  const entry = catalog.plugins.find(plugin => plugin.id === pluginId);
  if (!entry || entry.downloadUrl !== `${pluginPackagePrefix}${pluginId}.json`) {
    throw new Error("Плагин отсутствует в официальном каталоге");
  }
  let packageData: unknown;
  try {
    packageData = await fetchJson(entry.downloadUrl);
  } catch (error) {
    const fallbackPath = path.join(app.getAppPath(), "plugins", "packages", `${pluginId}.json`);
    try {
      packageData = JSON.parse(fs.readFileSync(fallbackPath, "utf8")) as unknown;
      writeLog("warning", `Пакет плагина ${pluginId} загружен из встроенного каталога после ошибки сети: ${getErrorMessage(error)}`);
    } catch (fallbackError) {
      writeLog("error", `Не удалось загрузить пакет плагина ${pluginId}: ${getErrorMessage(fallbackError)}`);
      throw new Error(`Не удалось загрузить пакет плагина: ${getErrorMessage(error)}; встроенный пакет: ${getErrorMessage(fallbackError)}`);
    }
  }
  if (!isPluginManifest(packageData) || packageData.id !== pluginId) {
    throw new Error("Загруженный пакет плагина не прошёл проверку");
  }
  fs.mkdirSync(pluginDirectory, { recursive: true });
  const filePath = path.join(pluginDirectory, `${pluginId}.json`);
  const currentlyInstalled = listInstalledPlugins().find(plugin => plugin.id === pluginId);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({
    manifest: packageData,
    enabled: currentlyInstalled?.enabled ?? true
  }), "utf8");
  fs.renameSync(temporaryPath, filePath);
  writeLog("info", `Установлен плагин «${packageData.name}» ${packageData.version}`);
  return listInstalledPlugins();
}

function setPluginEnabled(pluginId: string, enabled: boolean): InstalledPlugin[] {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(pluginId)) throw new Error("Некорректный идентификатор плагина");
  const filePath = path.join(pluginDirectory, `${pluginId}.json`);
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as { manifest: unknown; enabled: boolean };
  if (!isPluginManifest(saved.manifest)) throw new Error("Манифест установленного плагина не прошёл проверку");
  fs.writeFileSync(filePath, JSON.stringify({ manifest: saved.manifest, enabled }), "utf8");
  writeLog("info", `${enabled ? "Включён" : "Выключен"} плагин «${saved.manifest.name}»`);
  return listInstalledPlugins();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: "Anti-AFK",
    icon: path.join(__dirname, "../assets/icon.ico"),
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
    closeOverlayWindow();
  });
}

function showOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.showInactive();
    publishStatus();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    x: workArea.x + workArea.width - 270,
    y: workArea.y + 48,
    width: 250,
    height: 94,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  overlayWindow.on("closed", () => { overlayWindow = null; });
  const loadOverlay = app.isPackaged
    ? overlayWindow.loadFile(path.join(__dirname, "../dist/index.html"), { query: { overlay: "1" } })
    : overlayWindow.loadURL("http://127.0.0.1:5173/?overlay=1");
  void loadOverlay.then(() => overlayWindow?.showInactive()).catch(error => {
    writeLog("error", `Не удалось открыть таймер поверх игры: ${getErrorMessage(error)}`);
  });
  overlayWindow.setAlwaysOnTop(true);
}

function closeOverlayWindow() {
  if (!overlayWindow) return;
  const currentOverlay = overlayWindow;
  overlayWindow = null;
  currentOverlay.close();
}

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
  ], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function detectMinecraftWindows() {
  const script = String.raw`
    $items = Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -ne 0 -and
        $_.MainWindowTitle -and
        ($_.ProcessName -match 'java|Minecraft|WindowsStore')
      } |
      ForEach-Object {
        [PSCustomObject]@{
          id = "$($_.Id)"
          title = $_.MainWindowTitle
          processName = $_.ProcessName
          pid = $_.Id
        }
      }
    ConvertTo-Json -InputObject @($items) -Compress
  `;
  const output = await runPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  const windows = (Array.isArray(parsed) ? parsed : [parsed]).filter((x: any) =>
    /java|minecraft/i.test(String(x.processName))
  );
  writeLog("info", `Обнаружено окон Minecraft: ${windows.length}`);
  return windows;
}

async function performActions(): Promise<ActionAttempt> {
  if (!activeConfig || !runtime.running || runtime.paused) return "inactive";
  const targetPid = Number(activeConfig.target.pid);
  let actions: ActionName[];
  try {
    actions = [...new Set<ActionName>([...activeConfig.actions, ...getEnabledPluginActions()])];
  } catch (error) {
    runtime.message = "Не удалось загрузить список плагинов";
    if (Date.now() - lastActionErrorAt > 30000) {
      writeLog("error", `Не удалось получить действия плагинов: ${getErrorMessage(error)}`);
      lastActionErrorAt = Date.now();
    }
    publishStatus();
    return "error";
  }
  if (!Number.isInteger(targetPid) || targetPid <= 0 || !actions.length) {
    runtime.message = "Не удалось определить окно Minecraft";
    writeLog("error", "Действие отменено: неверный PID окна или пустой список действий");
    publishStatus();
    return "error";
  }

  // Inputs are deliberately sent only if the selected Minecraft window is foreground.
  const actionLines: string[] = [];
  if (actions.includes("jump")) {
    actionLines.push(`if (![AntiAfkNative]::SendKey([UInt32]${targetPid}, [UInt16]0x20, $false)) { exit 3 }; Start-Sleep -Milliseconds 100; [AntiAfkNative]::SendKey([UInt32]${targetPid}, [UInt16]0x20, $true)`);
  }
  if (actions.includes("walk")) {
    actionLines.push(`if (![AntiAfkNative]::SendKey([UInt32]${targetPid}, [UInt16]0x57, $false)) { exit 3 }; Start-Sleep -Milliseconds 300; [AntiAfkNative]::SendKey([UInt32]${targetPid}, [UInt16]0x57, $true)`);
  }
  if (actions.includes("camera")) {
    actionLines.push(`if (![AntiAfkNative]::MoveMouse([UInt32]${targetPid}, 14, 0)) { exit 3 }; Start-Sleep -Milliseconds 60; [AntiAfkNative]::MoveMouse([UInt32]${targetPid}, -14, 0)`);
  }

  const script = `
    Add-Type -TypeDefinition @'
    using System;
    using System.ComponentModel;
    using System.Runtime.InteropServices;
    public static class AntiAfkNative {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
      [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
      [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion data; }
      [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
      }
      [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
      }
      [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
      }
      private static bool IsForeground(uint expectedPid) {
        uint foregroundPid;
        GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid);
        return foregroundPid == expectedPid;
      }
      private static void Send(INPUT input) {
        if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
          throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      public static bool SendKey(uint pid, ushort key, bool keyUp) {
        if (!keyUp && !IsForeground(pid)) return false;
        INPUT input = new INPUT();
        input.type = 1;
        input.data.keyboard.wVk = key;
        input.data.keyboard.dwFlags = keyUp ? 2u : 0u;
        Send(input);
        return true;
      }
      public static bool MoveMouse(uint pid, int dx, int dy) {
        if (!IsForeground(pid)) return false;
        INPUT input = new INPUT();
        input.type = 0;
        input.data.mouse.dx = dx;
        input.data.mouse.dy = dy;
        input.data.mouse.dwFlags = 1;
        Send(input);
        return true;
      }
    }
'@
    $targetProcess = Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue
    if (!$targetProcess -or $targetProcess.ProcessName -notmatch 'java|Minecraft') { exit 4 }
    ${actionLines.join("; ")}
  `;
  let result: ActionAttempt;
  try {
    await runPowerShell(script);
    runtime.lastActionAt = Date.now();
    runtime.message = "Действие выполнено";
    lastFocusWarningAt = 0;
    lastActionErrorAt = 0;
    writeLog("info", `Выполнены действия: ${actions.join(", ")}`);
    result = "performed";
  } catch (error: any) {
    if (error?.code === 3) {
      runtime.message = "Ожидаем фокус Minecraft — переключитесь в игру";
      if (Date.now() - lastFocusWarningAt > 30000) {
        writeLog("warning", "Ожидание фокуса выбранного окна Minecraft; повторим попытку автоматически");
        lastFocusWarningAt = Date.now();
      }
      result = "unfocused";
    } else {
      runtime.message = error?.code === 4
        ? "Окно Minecraft больше недоступно — выберите его заново"
        : "Не удалось выполнить действие";
      if (Date.now() - lastActionErrorAt > 30000) {
        writeLog("error", `Не удалось выполнить действия: ${getErrorMessage(error)}`);
        lastActionErrorAt = Date.now();
      }
      result = "error";
    }
  }
  publishStatus();
  return result;
}

function stopRuntime() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (runtime.running) writeLog("info", "Автоматические действия остановлены");
  runtime = {
    ...runtime,
    running: false,
    paused: false,
    message: "Остановлено",
    nextActionAt: null
  };
  closeOverlayWindow();
  publishStatus();
}

function beginRuntimeLoop() {
  if (!activeConfig || !runtime.running || runtime.paused) return;
  if (timer) clearTimeout(timer);

  const runCycle = async () => {
    timer = null;
    if (!activeConfig || !runtime.running || runtime.paused) return;
    let attempt: ActionAttempt;
    try {
      attempt = await performActions();
    } catch (error) {
      runtime.message = "Не удалось выполнить действие";
      if (Date.now() - lastActionErrorAt > 30000) {
        writeLog("error", `Ошибка цикла действий: ${getErrorMessage(error)}`);
        lastActionErrorAt = Date.now();
      }
      publishStatus();
      attempt = "error";
    }
    if (!runtime.running || runtime.paused) return;
    const delay = attempt === "performed"
      ? Math.max(5000, Number(activeConfig.intervalMs) || 300000)
      : attempt === "unfocused" ? 2000 : 5000;
    runtime.nextActionAt = Date.now() + delay;
    runtime.intervalMs = delay;
    timer = setTimeout(() => { void runCycle(); }, delay);
    publishStatus();
  };

  timer = setTimeout(() => { void runCycle(); }, 0);
}

function togglePause() {
  if (!runtime.running) return runtime;
  runtime.paused = !runtime.paused;
  runtime.message = runtime.paused ? "Пауза" : "Работа продолжена";
  runtime.nextActionAt = null;
  writeLog("info", runtime.paused ? "Автоматические действия приостановлены" : "Автоматические действия продолжены");
  if (runtime.paused) {
    if (timer) clearTimeout(timer);
    timer = null;
  } else {
    beginRuntimeLoop();
  }
  publishStatus();
  return runtime;
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const startRegistered = globalShortcut.register("F6", () => {
    if (activeConfig && !runtime.running) {
      runtime.running = true;
      runtime.paused = false;
      runtime.message = "Запущено — ожидаем фокус Minecraft";
      writeLog("info", "Запуск по горячей клавише F6");
      beginRuntimeLoop();
      publishStatus();
    }
  });
  const stopRegistered = globalShortcut.register("F7", stopRuntime);
  const pauseRegistered = globalShortcut.register("F8", () => {
    togglePause();
  });
  if (!startRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F6");
  if (!stopRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F7");
  if (!pauseRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F8");
}

app.whenReady().then(async () => {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  logPath = path.join(app.getPath("userData"), "logs", "app.log");
  pluginDirectory = path.join(app.getPath("userData"), "plugins");
  writeLog("info", `Anti-AFK ${app.getVersion()} запущен`);

  autoUpdater.autoDownload = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.on("checking-for-update", () => {
    writeLog("info", "Проверка обновлений");
    publishUpdate("checking", "Проверяем обновления…");
  });
  autoUpdater.on("update-available", info => {
    writeLog("info", `Найдено обновление ${info.version}`);
    publishUpdate("available", "Доступна новая версия", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    writeLog("info", "Установлена последняя версия");
    publishUpdate("latest", "У вас установлена последняя версия");
  });
  autoUpdater.on("error", err => {
    writeLog("error", `Ошибка обновления: ${err.message}`);
    publishUpdate("error", `Ошибка обновления: ${err.message}`, updateState.version);
  });
  autoUpdater.on("download-progress", p =>
    publishUpdate("downloading", `Загрузка обновления: ${Math.round(p.percent)}%`, updateState.version)
  );
  autoUpdater.on("update-downloaded", info => {
    writeLog("info", `Обновление ${info.version} загружено и готово к установке`);
    publishUpdate("downloaded", "Обновление готово к установке", info.version);
  });

  ipcMain.handle("updates:state", () => updateState);
  ipcMain.handle("logs:list", () => {
    try {
      return readLogs();
    } catch (error) {
      writeLog("error", `Не удалось прочитать журнал: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("plugins:catalog", async () => {
    try {
      const catalog = await loadPluginCatalog();
      return { ...catalog, installed: listInstalledPlugins() };
    } catch (error) {
      writeLog("error", `Не удалось открыть каталог плагинов: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("plugins:list", () => listInstalledPlugins());
  ipcMain.handle("plugins:install", async (_event, pluginId: string) => {
    try {
      return await installPlugin(pluginId);
    } catch (error) {
      writeLog("error", `Не удалось установить плагин: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("plugins:set-enabled", (_event, pluginId: string, enabled: boolean) => {
    try {
      if (typeof enabled !== "boolean") throw new Error("Некорректное состояние плагина");
      return setPluginEnabled(pluginId, enabled);
    } catch (error) {
      writeLog("error", `Не удалось изменить состояние плагина: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("plugins:remove", (_event, pluginId: string) => {
    try {
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(pluginId)) throw new Error("Некорректный идентификатор плагина");
      const filePath = path.join(pluginDirectory, `${pluginId}.json`);
      fs.unlinkSync(filePath);
      writeLog("info", `Удалён плагин ${pluginId}`);
      return listInstalledPlugins();
    } catch (error) {
      writeLog("error", `Не удалось удалить плагин: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("updates:check", async () => {
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { publishUpdate("error", `Не удалось проверить обновления: ${getErrorMessage(error)}`); }
  });
  ipcMain.handle("updates:download", async () => {
    try {
      publishUpdate("downloading", "Подготавливаем загрузку обновления…", updateState.version);
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publishUpdate("error", `Не удалось загрузить обновление: ${getErrorMessage(error)}`, updateState.version);
    }
  });
  ipcMain.handle("updates:install", () => autoUpdater.quitAndInstall());

  ipcMain.handle("minecraft:detect", async () => {
    try {
      return await detectMinecraftWindows();
    } catch (error) {
      writeLog("error", `Не удалось найти окна Minecraft: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("afk:start", async (_event, config) => {
    const targetPid = Number(config?.target?.pid);
    if (!Number.isInteger(targetPid) || targetPid <= 0 || !Array.isArray(config.actions) ||
      !config.actions.length || !config.actions.every((action: unknown) =>
        typeof action === "string" && allowedActions.has(action as ActionName))) {
      writeLog("warning", "Запуск отменён: не выбрано окно Minecraft или действие");
      return { ok: false, message: "Обновите список окон Minecraft, выберите игру и хотя бы одно действие" };
    }
    if (timer) clearTimeout(timer);
    const intervalMs = Math.max(5000, Math.min(2147480000, Number(config.intervalMs) || 300000));
    activeConfig = { ...config, intervalMs };
    runtime = {
      running: true,
      paused: false,
      message: "Запущено — ожидаем фокус Minecraft",
      lastActionAt: null,
      nextActionAt: Date.now(),
      intervalMs
    };
    writeLog("info", `Автоматические действия запущены для окна «${config.target.title}»`);
    showOverlayWindow();
    beginRuntimeLoop();
    publishStatus();
    return { ok: true, message: "Anti-AFK запущен" };
  });
  ipcMain.handle("afk:stop", stopRuntime);
  ipcMain.handle("afk:pause", togglePause);
  ipcMain.handle("overlay:close", closeOverlayWindow);
  ipcMain.handle("overlay:show", () => {
    if (runtime.running) showOverlayWindow();
  });
  ipcMain.handle("afk:status", () => runtime);
  ipcMain.handle("settings:save", (_event, value) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(value, null, 2), "utf8");
      writeLog("info", "Настройки сохранены");
    } catch (error) {
      writeLog("error", `Не удалось сохранить настройки: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("settings:load", () => {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      writeLog("error", `Не удалось загрузить настройки: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("app:open-repository", async () => {
    try {
      await shell.openExternal("https://github.com/givekoll-sketch/Anti-AFK");
    } catch (error) {
      writeLog("error", `Не удалось открыть GitHub: ${getErrorMessage(error)}`);
      throw error;
    }
  });
  ipcMain.handle("app:open-telegram", async () => {
    try {
      await shell.openExternal("https://t.me/+bhbJN3fL9NQxZGIy");
      writeLog("info", "Открыта ссылка на новостной Telegram-канал");
    } catch (error) {
      writeLog("error", `Не удалось открыть Telegram: ${getErrorMessage(error)}`);
      throw error;
    }
  });

  if (app.isPackaged) {
    publishUpdate("checking", "Проверяем наличие обновлений…");
    const startupCheck = autoUpdater.checkForUpdates().catch(error => {
      publishUpdate("error", `Не удалось проверить обновления: ${getErrorMessage(error)}`);
    });
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      startupCheck,
      new Promise<void>(resolve => { timeout = setTimeout(resolve, 5000); })
    ]);
    if (timeout) clearTimeout(timeout);
  }

  createWindow();
  registerHotkeys();
});

app.on("will-quit", () => {
  if (timer) clearInterval(timer);
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
