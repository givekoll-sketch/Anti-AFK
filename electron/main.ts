import { app, BrowserWindow, ipcMain, globalShortcut, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let runtime = { running: false, paused: false, message: "Ожидание запуска", lastActionAt: null as number | null };
let activeConfig: any = null;
let settingsPath = "";
type UpdateStatus = "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
type UpdateState = { status: UpdateStatus; message: string; version?: string };
type LogLevel = "info" | "warning" | "error";
type AppLogEntry = { timestamp: string; level: LogLevel; message: string };
let updateState: UpdateState = { status: "idle", message: "Проверка обновлений ещё не выполнялась" };
let logPath = "";

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
}

function publishUpdate(status: UpdateStatus, message: string, version?: string) {
  updateState = { status, message, version };
  mainWindow?.webContents.send("updates:state", updateState);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  mainWindow.on("closed", () => { mainWindow = null; });
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

async function performActions() {
  if (!activeConfig || !runtime.running || runtime.paused) return;
  const targetTitle = String(activeConfig.target.title).replace(/'/g, "''");
  const actions: string[] = activeConfig.actions;
  if (!actions.length) return;

  // Inputs are deliberately sent only if the selected Minecraft window is foreground.
  const actionLines: string[] = [];
  if (actions.includes("jump")) {
    actionLines.push("[AntiAfkNative]::keybd_event(0x20, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [AntiAfkNative]::keybd_event(0x20, 0, 2, [UIntPtr]::Zero)");
  }
  if (actions.includes("walk")) {
    actionLines.push("[AntiAfkNative]::keybd_event(0x57, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 450; [AntiAfkNative]::keybd_event(0x57, 0, 2, [UIntPtr]::Zero)");
  }
  if (actions.includes("camera")) {
    actionLines.push("[AntiAfkNative]::mouse_event(0x0001, 14, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [AntiAfkNative]::mouse_event(0x0001, -14, 0, 0, [UIntPtr]::Zero)");
  }

  const script = `
    Add-Type -TypeDefinition @'
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public static class AntiAfkNative {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
      [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    }
'@
    $handle = [AntiAfkNative]::GetForegroundWindow()
    $buffer = New-Object System.Text.StringBuilder 512
    [void][AntiAfkNative]::GetWindowText($handle, $buffer, $buffer.Capacity)
    $foregroundTitle = $buffer.ToString()
    if ($foregroundTitle -ne '${targetTitle}') { exit 3 }
    ${actionLines.join("; ")}
  `;
  try {
    await runPowerShell(script);
    runtime.lastActionAt = Date.now();
    runtime.message = "Действие выполнено";
    writeLog("info", `Выполнены действия: ${actions.join(", ")}`);
  } catch (error: any) {
    runtime.message = error?.code === 3
      ? "Ожидание фокуса Minecraft"
      : "Не удалось выполнить действие";
    if (error?.code === 3) {
      writeLog("warning", "Действие пропущено: окно Minecraft не в фокусе");
    } else {
      writeLog("error", `Не удалось выполнить действия: ${getErrorMessage(error)}`);
    }
  }
  publishStatus();
}

function stopRuntime() {
  if (timer) clearInterval(timer);
  timer = null;
  if (runtime.running) writeLog("info", "Автоматические действия остановлены");
  runtime = { running: false, paused: false, message: "Остановлено", lastActionAt: runtime.lastActionAt };
  publishStatus();
}

function beginRuntimeLoop() {
  if (!activeConfig) return;
  if (timer) clearInterval(timer);
  timer = setInterval(performActions, Math.max(5000, Number(activeConfig.intervalMs) || 300000));
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const startRegistered = globalShortcut.register("F6", () => {
    if (activeConfig && !runtime.running) {
      runtime.running = true;
      runtime.paused = false;
      runtime.message = "Запущено горячей клавишей";
      writeLog("info", "Запуск по горячей клавише F6");
      beginRuntimeLoop();
      publishStatus();
    }
  });
  const stopRegistered = globalShortcut.register("F7", stopRuntime);
  const pauseRegistered = globalShortcut.register("F8", () => {
    if (runtime.running) {
      runtime.paused = !runtime.paused;
      runtime.message = runtime.paused ? "Пауза" : "Работа продолжена";
      writeLog("info", runtime.paused ? "Пауза по горячей клавише F8" : "Продолжение по горячей клавише F8");
      publishStatus();
    }
  });
  if (!startRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F6");
  if (!stopRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F7");
  if (!pauseRegistered) writeLog("warning", "Не удалось зарегистрировать горячую клавишу F8");
}

app.whenReady().then(async () => {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  logPath = path.join(app.getPath("userData"), "logs", "app.log");
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
    if (!config?.target?.title || !Array.isArray(config.actions) || !config.actions.length) {
      writeLog("warning", "Запуск отменён: не выбрано окно Minecraft или действие");
      return { ok: false, message: "Выберите окно Minecraft и хотя бы одно действие" };
    }
    if (timer) clearInterval(timer);
    activeConfig = config;
    runtime = { running: true, paused: false, message: "Запущено — ожидаем окно Minecraft", lastActionAt: null };
    writeLog("info", `Автоматические действия запущены для окна «${config.target.title}»`);
    beginRuntimeLoop();
    publishStatus();
    return { ok: true, message: "Anti-AFK запущен" };
  });
  ipcMain.handle("afk:stop", stopRuntime);
  ipcMain.handle("afk:pause", () => {
    if (!runtime.running) return runtime;
    runtime.paused = !runtime.paused;
    runtime.message = runtime.paused ? "Пауза" : "Работа продолжена";
    writeLog("info", runtime.paused ? "Автоматические действия приостановлены" : "Автоматические действия продолжены");
    publishStatus();
    return runtime;
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
