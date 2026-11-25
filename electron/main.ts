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

function publishStatus() {
  mainWindow?.webContents.send("afk:status-changed", runtime);
}

function publishUpdate(status: string, message: string, version?: string) {
  mainWindow?.webContents.send("updates:state", { status, message, version });
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
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((x: any) =>
    /java|minecraft/i.test(String(x.processName))
  );
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
  } catch (error: any) {
    runtime.message = error?.code === 3
      ? "Ожидание фокуса Minecraft"
      : "Не удалось выполнить действие";
  }
  publishStatus();
}

function stopRuntime() {
  if (timer) clearInterval(timer);
  timer = null;
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
  globalShortcut.register("F6", () => {
    if (activeConfig && !runtime.running) {
      runtime.running = true;
      runtime.paused = false;
      runtime.message = "Запущено горячей клавишей";
      beginRuntimeLoop();
      publishStatus();
    }
  });
  globalShortcut.register("F7", stopRuntime);
  globalShortcut.register("F8", () => {
    if (runtime.running) {
      runtime.paused = !runtime.paused;
      runtime.message = runtime.paused ? "Пауза" : "Работа продолжена";
      publishStatus();
    }
  });
}

app.whenReady().then(() => {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  createWindow();
  registerHotkeys();

  autoUpdater.autoDownload = false;
  autoUpdater.on("checking-for-update", () => publishUpdate("checking", "Проверяем обновления…"));
  autoUpdater.on("update-available", info => publishUpdate("available", "Доступна новая версия", info.version));
  autoUpdater.on("update-not-available", () => publishUpdate("latest", "У вас установлена последняя версия"));
  autoUpdater.on("error", err => publishUpdate("error", `Ошибка обновления: ${err.message}`));
  autoUpdater.on("download-progress", p => publishUpdate("downloading", `Загрузка обновления: ${Math.round(p.percent)}%`));
  autoUpdater.on("update-downloaded", info => publishUpdate("downloaded", "Обновление готово к установке", info.version));

  ipcMain.handle("minecraft:detect", detectMinecraftWindows);
  ipcMain.handle("afk:start", async (_event, config) => {
    if (!config?.target?.title || !Array.isArray(config.actions) || !config.actions.length) {
      return { ok: false, message: "Выберите окно Minecraft и хотя бы одно действие" };
    }
    stopRuntime();
    activeConfig = config;
    runtime = { running: true, paused: false, message: "Запущено — ожидаем окно Minecraft", lastActionAt: null };
    beginRuntimeLoop();
    publishStatus();
    return { ok: true, message: "Anti-AFK запущен" };
  });
  ipcMain.handle("afk:stop", stopRuntime);
  ipcMain.handle("afk:pause", () => {
    if (runtime.running) runtime.paused = !runtime.paused;
    runtime.message = runtime.paused ? "Пауза" : "Работа продолжена";
    publishStatus();
    return runtime;
  });
  ipcMain.handle("afk:status", () => runtime);
  ipcMain.handle("settings:save", (_event, value) => {
    fs.writeFileSync(settingsPath, JSON.stringify(value, null, 2), "utf8");
  });
  ipcMain.handle("settings:load", () => {
    try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
    catch { return null; }
  });
  ipcMain.handle("updates:check", async () => {
    try { await autoUpdater.checkForUpdates(); }
    catch (error: any) { publishUpdate("error", error.message); }
  });
  ipcMain.handle("updates:download", async () => {
    try { await autoUpdater.downloadUpdate(); }
    catch (error: any) { publishUpdate("error", error.message); }
  });
  ipcMain.handle("updates:install", () => autoUpdater.quitAndInstall());
  ipcMain.handle("app:open-repository", () =>
    shell.openExternal("https://github.com/givekoll-sketch/Anti-AFK")
  );
});

app.on("will-quit", () => {
  if (timer) clearInterval(timer);
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
