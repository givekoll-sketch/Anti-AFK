import { useEffect, useMemo, useState } from "react";
import {
  Activity, Gamepad2, House, Info, Keyboard, Moon, Sun, Monitor,
  RefreshCw, Play, Square, Pause, ChevronDown, CheckCircle2, AlertCircle,
  Clock3, RotateCw, Footprints, ArrowUp, Download, Github, ScrollText,
  SlidersHorizontal, Puzzle, Languages, Palette, Sparkles, ExternalLink, Store,
  Trash2, Power, X, Search
} from "lucide-react";
import logoSmall from "../assets/logo-small.png";
import logo from "../assets/logo.png";
import { translate, type Language, type LocaleKey } from "./locales";
import "./feature-pages.css";
import "./update-banner.css";
import "./theme.css";

type MinecraftWindow = { id: string; title: string; processName: string; pid: number };
type ActionName = "camera" | "jump" | "walk";
type CatalogPlugin = {
  id: string; name: string; version: string; author: string; description: string;
  actions: ActionName[]; downloadUrl: string;
};
type InstalledPlugin = Omit<CatalogPlugin, "downloadUrl"> & { enabled: boolean };
type UpdateState = {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
  message: string;
  version?: string;
};
type PageId = "home" | "keys" | "log" | "settings" | "plugins" | "about";
type AppLogEntry = { timestamp: string; level: "info" | "warning" | "error"; message: string };
type StyleId = "default" | "minecraft" | "oled" | "nether" | "end";
const actionInfo: { id: ActionName; title: LocaleKey; desc: LocaleKey; icon: any }[] = [
  { id: "camera", title: "camera", desc: "cameraDesc", icon: RotateCw },
  { id: "jump", title: "jump", desc: "jumpDesc", icon: ArrowUp },
  { id: "walk", title: "walk", desc: "walkDesc", icon: Footprints }
];

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [language, setLanguage] = useState<Language>("ru");
  const [style, setStyle] = useState<StyleId>("default");
  const [animations, setAnimations] = useState(true);
  const [windows, setWindows] = useState<MinecraftWindow[]>([]);
  const [selected, setSelected] = useState("");
  const [actions, setActions] = useState<ActionName[]>(["camera", "jump"]);
  const [interval, setIntervalValue] = useState("5");
  const [unit, setUnit] = useState<"seconds" | "minutes" | "hours">("minutes");
  const [status, setStatus] = useState({
    running: false, paused: false, message: "Ожидание запуска",
    lastActionAt: null as number | null, nextActionAt: null as number | null, intervalMs: 300000
  });
  const [update, setUpdate] = useState<UpdateState>({ status: "idle", message: "Проверка ещё не выполнялась" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [skipUpdateWarning, setSkipUpdateWarning] = useState(false);
  const [decliningUpdate, setDecliningUpdate] = useState(false);
  const [updatePromptDismissed, setUpdatePromptDismissed] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [toast, setToast] = useState("");
  const [pluginTab, setPluginTab] = useState<"market" | "mine">("market");
  const [pluginCatalog, setPluginCatalog] = useState<CatalogPlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [pluginWarning, setPluginWarning] = useState("");
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginBusy, setPluginBusy] = useState("");
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginDetails, setPluginDetails] = useState<CatalogPlugin | InstalledPlugin | null>(null);
  const [pendingSetting, setPendingSetting] = useState<{ rollback: () => void } | null>(null);
  const selectedWindow = useMemo(() => windows.find(w => w.id === selected), [windows, selected]);
  const filteredPluginCatalog = pluginCatalog.filter(plugin =>
    `${plugin.name} ${plugin.description} ${plugin.author}`.toLocaleLowerCase().includes(pluginSearch.toLocaleLowerCase())
  );
  const t = (key: LocaleKey, values?: Record<string, string | number>) => translate(language, key, values);

  useEffect(() => {
    window.antiAfk.loadSettings().then(saved => {
      if (!saved) return;
      if (saved.theme) setTheme(saved.theme);
      if (["ru", "en", "es", "pt", "ko", "ja", "zh", "pl"].includes(saved.language)) setLanguage(saved.language);
      if (["default", "minecraft", "oled", "nether", "end"].includes(saved.style)) setStyle(saved.style);
      if (typeof saved.animations === "boolean") setAnimations(saved.animations);
      if (saved.actions) setActions(saved.actions);
      if (saved.interval) setIntervalValue(saved.interval);
      if (saved.unit) setUnit(saved.unit);
      if (saved.selected) setSelected(saved.selected);
      setSkipUpdateWarning(saved.skipUpdateWarning === true);
    }).catch(() => notify("Не удалось загрузить настройки"))
      .finally(() => setSettingsLoaded(true));
    window.antiAfk.getStatus().then(setStatus);
    const offStatus = window.antiAfk.onStatus(setStatus);
    const showUpdate = (state: UpdateState) => {
      setUpdate(state);
      if (state.status === "available") {
        setDecliningUpdate(false);
        setUpdatePromptDismissed(false);
      }
    };
    const offUpdate = window.antiAfk.onUpdate(showUpdate);
    const offLog = window.antiAfk.onLog(entry => setLogs(current => [entry, ...current].slice(0, 500)));
    window.antiAfk.getUpdateState().then(showUpdate).catch(() => {
      setUpdate({ status: "error", message: "Не удалось получить состояние обновлений" });
    });
    scanWindows();
    return () => { offStatus(); offUpdate(); offLog(); };
  }, []);

  useEffect(() => {
    if (page !== "log") return;
    window.antiAfk.getLogs()
      .then(setLogs)
      .catch(() => notify("Не удалось загрузить журнал действий"));
  }, [page]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.style = style;
    document.documentElement.dataset.animations = String(animations);
    document.documentElement.lang = language;
    if (!settingsLoaded) return;
    window.antiAfk.saveSettings({ theme, language, style, animations, actions, interval, unit, selected, skipUpdateWarning })
      .catch(() => notify("Не удалось сохранить настройки"));
  }, [theme, language, style, animations, actions, interval, unit, selected, skipUpdateWarning, settingsLoaded]);

  useEffect(() => {
    if (page === "plugins") void refreshPlugins();
  }, [page]);

  async function scanWindows() {
    setDetecting(true);
    try {
      const found = await window.antiAfk.detectWindows();
      setWindows(found);
      if (found.length && !found.some(w => w.id === selected)) setSelected(found[0].id);
      if (!found.length) setToast(t("toastNoWindows"));
    } catch {
      setToast(t("toastScanFailed"));
    } finally { setDetecting(false); }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function refreshPlugins() {
    setPluginLoading(true);
    try {
      const result = await window.antiAfk.getPluginCatalog();
      setPluginCatalog(result.plugins);
      setInstalledPlugins(result.installed);
      setPluginWarning(result.warning ?? "");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось загрузить каталог плагинов");
    } finally {
      setPluginLoading(false);
    }
  }

  async function installPlugin(pluginId: string) {
    setPluginBusy(pluginId);
    try {
      setInstalledPlugins(await window.antiAfk.installPlugin(pluginId));
      setPluginTab("mine");
      notify(t("installed"));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось установить плагин");
    } finally {
      setPluginBusy("");
    }
  }

  async function togglePlugin(plugin: InstalledPlugin) {
    setPluginBusy(plugin.id);
    try {
      setInstalledPlugins(await window.antiAfk.setPluginEnabled(plugin.id, !plugin.enabled));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось изменить состояние плагина");
    } finally {
      setPluginBusy("");
    }
  }

  async function removePlugin(pluginId: string) {
    setPluginBusy(pluginId);
    try {
      setInstalledPlugins(await window.antiAfk.removePlugin(pluginId));
      setPluginDetails(null);
      notify(t("remove"));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось удалить плагин");
    } finally {
      setPluginBusy("");
    }
  }

  async function start() {
    if (!selectedWindow) return notify(t("toastWindowSelect"));
    if (!actions.length) return notify(t("toastActionSelect"));
    const n = Math.max(5, Number(interval) || 5);
    const multiplier = unit === "seconds" ? 1000 : unit === "minutes" ? 60000 : 3600000;
    const result = await window.antiAfk.start({
      target: selectedWindow, actions, intervalMs: n * multiplier
    });
    notify(result.ok ? t("started") : result.message);
  }

  const nav = [
    { id: "home" as const, label: t("home"), icon: House },
    { id: "keys" as const, label: t("hotkeys"), icon: Keyboard },
    { id: "log" as const, label: t("log"), icon: ScrollText },
    { id: "settings" as const, label: t("settings"), icon: SlidersHorizontal },
    { id: "plugins" as const, label: t("plugins"), icon: Puzzle },
    { id: "about" as const, label: t("about"), icon: Info }
  ];
  const showUpdateBanner = settingsLoaded && !updatePromptDismissed &&
    (update.status === "available" || update.status === "downloading" || update.status === "downloaded");

  function declineUpdate() {
    if (skipUpdateWarning) {
      setUpdatePromptDismissed(true);
      return;
    }
    setDecliningUpdate(true);
  }

  function downloadUpdate() {
    setDecliningUpdate(false);
    void window.antiAfk.downloadUpdate();
  }

  function acknowledgeDecline() {
    setDecliningUpdate(false);
    setUpdatePromptDismissed(true);
  }

  function applySetting<T>(current: T, next: T, setter: (value: T) => void) {
    if (current === next) return;
    setter(next);
    setPendingSetting({ rollback: () => setter(current) });
  }

  function localizeStatus(message: string) {
    const statusKeys: Record<string, LocaleKey> = {
      "Действие выполнено": "statusActive",
      "Ожидаем фокус Minecraft — переключитесь в игру": "statusWaitingFocus",
      "Запущено — ожидаем фокус Minecraft": "statusWaitingFocus",
      "Ожидание запуска": "statusIdle",
      "Не удалось выполнить действие": "statusError",
      "Окно Minecraft больше недоступно — выберите его заново": "statusTargetLost",
      "Не удалось загрузить список плагинов": "statusPluginsFailed",
      "Пауза": "paused",
      "Работа продолжена": "working",
      "Остановлено": "notRunning"
    };
    const key = statusKeys[message];
    return key ? t(key) : message;
  }

  function localizeUpdateMessage() {
    switch (update.status) {
      case "idle": return t("updateIdle");
      case "checking": return t("updateChecking");
      case "available": return t("updateIntro");
      case "latest": return t("updateLatest");
      case "downloading": return t("updateDownloading", { version: update.version ?? "" });
      case "downloaded": return t("updateReady", { version: update.version ?? "" });
      case "error": return `${t("updateError")}: ${update.message}`;
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src={logoSmall} alt="" /></div>
          <div><div className="brand-name">ANTI-AFK</div>          <div className="brand-sub">{t("brandSubtitle")}</div></div>
        </div>
        <div className="nav-caption">{t("menu")}</div>
        <nav className="sidebar-nav">{nav.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => {
            setPage(item.id);
          }}>
            <span className="nav-icon"><Icon size={18} /></span><span>{item.label}</span>
          </button>;
        })}</nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className={`status-dot ${status.running ? "on" : ""}`} /><span>{status.running ? (status.paused ? t("paused") : t("working")) : t("notRunning")}</span></div>
          <div className="version">ANTI-AFK · v1.0.4</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">Anti-AFK <span>/</span> {nav.find(n => n.id === page)?.label}</div>
          <div className="topbar-status"><span className={`status-dot ${status.running ? "on" : ""}`} />{status.running ? (status.paused ? t("paused") : t("working")) : t("ready")}</div>
        </header>

        {showUpdateBanner && <section className={`update-banner ${decliningUpdate ? "warning" : ""}`} aria-live="polite">
          <div className="update-banner-copy">
            <strong>{decliningUpdate
              ? t("declined")
              : update.status === "available"
                ? t("updateAvailable", { version: update.version ?? "" })
                : update.status === "downloaded"
                  ? t("updateReady", { version: update.version ?? "" })
                  : t("updateDownloading", { version: update.version ?? "" })}</strong>
            <p>{decliningUpdate
              ? t("declineWarning")
              : update.status === "available"
                ? t("updateIntro")
                : update.message}</p>
            {decliningUpdate && <label className="update-warning-option">
              <input
                type="checkbox"
                checked={skipUpdateWarning}
                onChange={event => setSkipUpdateWarning(event.target.checked)}
              />
              {t("hideDeclineWarning")}
            </label>}
          </div>
          <div className="update-banner-actions">
            {decliningUpdate ? <>
              <button className="button secondary" onClick={acknowledgeDecline}>{t("acknowledge")}</button>
              <button className="button primary" onClick={downloadUpdate}><Download size={15}/>{t("install")}</button>
            </> : update.status === "available" ? <>
              <button className="button primary" onClick={downloadUpdate}><Download size={15}/>{t("install")}</button>
              <button className="button secondary" onClick={declineUpdate}>{t("cancel")}</button>
            </> : update.status === "downloaded" ? <>
              <button className="button primary" onClick={() => window.antiAfk.installUpdate()}>{t("installRestart")}</button>
              <button className="button secondary" onClick={() => setUpdatePromptDismissed(true)}>{t("later")}</button>
            </> : <button className="button secondary" disabled>{update.message}</button>}
          </div>
        </section>}

        {page === "home" && <section className="page">
          <div className="page-heading">
            <div><div className="eyebrow">{t("homeEyebrow")}</div><h1>{t("home")}</h1><p>{t("homeSubtitle")}</p></div>
            <div className={`running-pill ${status.running ? "running" : ""}`}><span className="status-dot" />{status.running ? (status.paused ? t("paused") : t("working")) : t("notRunning")}</div>
          </div>

          <div className="panel window-panel">
            <div className="panel-head"><div className="panel-title"><div className="icon-tile"><Monitor size={18}/></div><div><h2>{t("windowTitle")}</h2><p>{t("windowSubtitle")}</p></div></div>
              <button className="button secondary small" onClick={scanWindows} disabled={detecting}><RefreshCw size={15} className={detecting ? "spin" : ""}/>{detecting ? t("searching") : t("refresh")}</button>
            </div>
            <div className="select-wrap"><Gamepad2 size={18}/><select value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">{t("chooseWindow")}</option>
              {windows.map(w => <option value={w.id} key={w.id}>{w.title} · {w.processName} · PID {w.pid}</option>)}
            </select><ChevronDown size={16}/></div>
            <div className="window-foot"><span className={`status-dot ${selectedWindow ? "on" : ""}`}/>{selectedWindow ? `${selectedWindow.processName} (PID ${selectedWindow.pid})` : t("noWindow")}<span className="muted">{t("javaBedrock")}</span></div>
          </div>

          <div className="content-grid">
            <div className="panel actions-panel">
              <div className="panel-head"><div><h2>{t("actions")}</h2><p>{t("actionsSubtitle")}</p></div><span className="counter">{actions.length} / 3</span></div>
              <div className="action-list">{actionInfo.map(a => {
                const Icon = a.icon; const checked = actions.includes(a.id);
                return <button key={a.id} className={`action-row ${checked ? "checked" : ""}`} onClick={() => setActions(old => checked ? old.filter(x => x !== a.id) : [...old, a.id])}>
                  <div className="action-icon"><Icon size={18}/></div><div className="action-copy"><strong>{t(a.title)}</strong><span>{t(a.desc)}</span></div>
                  <span className={`switch ${checked ? "enabled" : ""}`}><i/></span>
                </button>;
              })}</div>
              <div className="hint"><AlertCircle size={15}/> {t("focusHint")}</div>
              {status.running && <button className="button secondary small overlay-toggle" onClick={() => void window.antiAfk.showOverlay()}><Clock3 size={15}/>{t("showTimer")}</button>}
            </div>

            <div className="right-stack">
              <div className="panel interval-panel">
                <div className="panel-head"><div><h2>{t("interval")}</h2><p>{t("intervalSubtitle")}</p></div><Clock3 size={18} className="muted-icon"/></div>
                <div className="interval-controls"><input type="number" min="5" value={interval} onChange={e => setIntervalValue(e.target.value)} /><select value={unit} onChange={e => setUnit(e.target.value as any)}><option value="seconds">{t("seconds")}</option><option value="minutes">{t("minutes")}</option><option value="hours">{t("hours")}</option></select></div>
                <div className="field-note">{t("minInterval")}</div>
              </div>
              <div className="panel run-panel">
                <div className="panel-head"><div><h2>{t("controls")}</h2><p>{localizeStatus(status.message)}</p></div><Activity size={18} className="muted-icon"/></div>
                <div className="run-buttons">
                  {!status.running ? <button className="button primary" onClick={start}><Play size={16} fill="currentColor"/>{t("start")}</button> :
                    <button className="button secondary" onClick={() => window.antiAfk.pause()}><Pause size={16}/>{status.paused ? t("resume") : t("pause")}</button>}
                  <button className="button danger" onClick={() => window.antiAfk.stop()} disabled={!status.running}><Square size={15} fill="currentColor"/>{t("stop")}</button>
                </div>
                <div className="hotkey-line"><span>{t("quickControls")}</span><div><kbd>F6</kbd><kbd>F7</kbd><kbd>F8</kbd></div></div>
              </div>
            </div>
          </div>
          <div className="panel activity-panel"><div className="activity-label"><span className="status-dot" />{t("statusLabel")}</div><div className="activity-message">{localizeStatus(status.message)}</div><div className="activity-time">{status.lastActionAt ? `${t("lastAction")}: ${new Date(status.lastActionAt).toLocaleTimeString()}` : t("waiting")}</div></div>
        </section>}

        {page === "keys" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">{t("homeEyebrow")}</div><h1>{t("hotkeys")}</h1><p>{t("keysSubtitle")}</p></div></div>
          <div className="panel keys-panel">
            {[[t("start"),"F6",t("keyStartDesc")],[t("stop"),"F7",t("keyStopDesc")],[`${t("pause")} / ${t("resume")}`,"F8",t("keyPauseDesc")]].map(([name,key,desc]) => <div className="key-row" key={key}><div><strong>{name}</strong><span>{desc}</span></div><kbd>{key}</kbd></div>)}
            <div className="hint"><Info size={15}/>{t("keysTip")}</div>
          </div>
        </section>}

        {page === "log" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">{t("diagnostics")}</div><h1>{t("log")}</h1><p>{t("logsSubtitle")}</p></div><span className="counter">{logs.length} · {t("entries")}</span></div>
          <div className="panel log-panel">
            {logs.length ? <div className="log-list">{logs.map((entry, index) => <article className={`log-entry log-${entry.level}`} key={`${entry.timestamp}-${index}`}>
              <span className="log-level">{entry.level === "error" ? t("levelError") : entry.level === "warning" ? t("levelWarning") : t("levelInfo")}</span>
              <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
              <p>{entry.message}</p>
            </article>)}</div> : <div className="empty-state"><ScrollText size={28}/><strong>{t("noLogs")}</strong><span>{t("noLogsDesc")}</span></div>}
          </div>
          <p className="field-note">{t("localLogNote")}</p>
        </section>}

        {page === "settings" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">{t("personalization")}</div><h1>{t("settings")}</h1><p>{t("settingsSubtitle")}</p></div></div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Sun size={18}/></span><div><h2>{t("theme")}</h2><p>{t("themeSubtitle")}</p></div></div>
            <div className="choice-row theme-choices">
              <button className={`choice-chip ${theme === "light" ? "selected" : ""}`} onClick={() => applySetting(theme, "light", setTheme)}><Sun size={15}/>{t("light")}</button>
              <button className={`choice-chip ${theme === "dark" ? "selected" : ""}`} onClick={() => applySetting(theme, "dark", setTheme)}><Moon size={15}/>{t("dark")}</button>
            </div>
          </div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Languages size={18}/></span><div><h2>{t("language")}</h2><p>{t("languageSubtitle")}</p></div></div>
            <div className="choice-grid language-choices">
              {[
                ["ru", "🇷🇺", "languageRussian"], ["en", "🇺🇸", "languageEnglish"],
                ["es", "🇪🇸", "languageSpanish"], ["pt", "🇵🇹", "languagePortuguese"],
                ["ko", "🇰🇷", "languageKorean"], ["ja", "🇯🇵", "languageJapanese"],
                ["zh", "🇨🇳", "languageChinese"], ["pl", "🇵🇱", "languagePolish"]
              ].map(([id, flag, label]) => <button className={`choice-chip ${language === id ? "selected" : ""}`} key={id} onClick={() => applySetting(language, id as Language, setLanguage)}><span>{flag}</span>{t(label as LocaleKey)}</button>)}
            </div>
          </div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Palette size={18}/></span><div><h2>{t("style")}</h2><p>{t("styleSubtitle")}</p></div></div>
            <div className="choice-grid style-choices">
              {[
                ["minecraft", "minecraftStyle", "pixelStyle"], ["oled", "oled", "pureBlack"],
                ["nether", "nether", "crimson"], ["end", "end", "endStyle"]
              ].map(([id, label, description]) => <button className={`style-chip style-${id} ${style === id ? "selected" : ""}`} key={id} onClick={() => applySetting(style, id as StyleId, setStyle)}><span className="style-swatch"/><strong>{t(label as LocaleKey)}</strong><small>{t(description as LocaleKey)}</small></button>)}
            </div>
          </div>
          <div className="panel settings-card animation-setting">
            <div className="settings-section-head"><span className="settings-icon"><Sparkles size={18}/></span><div><h2>{t("animations")}</h2><p>{t("animationsSubtitle")}</p></div></div>
            <button className="switch-row" aria-pressed={animations} onClick={() => applySetting(animations, !animations, setAnimations)}><span>{t(animations ? "animationsOn" : "animationsOff")}</span><span className={`switch ${animations ? "enabled" : ""}`}><i/></span></button>
          </div>
          <div className="hint settings-roadmap"><Info size={15}/>{t("settingsAppliedHint")}</div>
        </section>}

        {page === "plugins" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">{t("extensions")}</div><h1>{t("plugins")}</h1><p>{t("pluginsSubtitle")}</p></div></div>
          <div className="plugin-tabs" role="tablist">
            <button role="tab" aria-selected={pluginTab === "market"} className={pluginTab === "market" ? "selected" : ""} onClick={() => setPluginTab("market")}><Store size={16}/>{t("marketTab")}<span>{pluginCatalog.length}</span></button>
            <button role="tab" aria-selected={pluginTab === "mine"} className={pluginTab === "mine" ? "selected" : ""} onClick={() => setPluginTab("mine")}><Puzzle size={16}/>{t("mineTab")}<span>{installedPlugins.length}</span></button>
          </div>
          <div className="plugin-toolbar">
            <div className="plugin-toolbar-copy">
              <strong>{t(pluginTab === "market" ? "marketInfo" : "mineInfo")}</strong>
              <span>{t("pluginSafeNote")}</span>
            </div>
            <button className="button secondary small" onClick={() => void refreshPlugins()} disabled={pluginLoading}>
              <RefreshCw size={14} className={pluginLoading ? "spin" : ""}/>{t("refresh")}
            </button>
          </div>
          {pluginWarning && <div className="plugin-warning"><Info size={15}/>{t("offlineCatalog")}</div>}
          {pluginTab === "market" && <div className="plugin-market">
            <label className="plugin-search"><Search size={16}/><input value={pluginSearch} onChange={event => setPluginSearch(event.target.value)} placeholder={t("searchPlugins")}/></label>
            {pluginLoading && <div className="empty-state"><RefreshCw className="spin" size={24}/><strong>{t("loading")}</strong></div>}
            {!pluginLoading && filteredPluginCatalog.map(plugin => {
              const isInstalled = installedPlugins.some(installed => installed.id === plugin.id);
              return <article className="panel plugin-card" key={plugin.id}>
                <div className="plugin-card-icon"><Puzzle size={20}/></div>
                <div className="plugin-card-copy">
                  <div className="plugin-card-title"><h2>{plugin.name}</h2><span className="plugin-version">v{plugin.version}</span></div>
                  <p>{plugin.description}</p>
                  <div className="plugin-meta">{t("author")}: {plugin.author}</div>
                  <div className="plugin-action-tags">{plugin.actions.map(action => <span key={action}>{t(action)}</span>)}</div>
                </div>
                <div className="plugin-card-buttons">
                  <button className="button secondary small" onClick={() => setPluginDetails(plugin)}>{t("details")}</button>
                  <button className={`button ${isInstalled ? "secondary" : "primary"} small`} disabled={isInstalled || pluginBusy === plugin.id} onClick={() => void installPlugin(plugin.id)}>
                    <Download size={14}/>{isInstalled ? t("installed") : pluginBusy === plugin.id ? t("loading") : t("installPlugin")}
                  </button>
                </div>
              </article>;
            })}
            {!pluginLoading && pluginCatalog.length === 0 && <div className="empty-state"><Store size={28}/><strong>{t("emptyMarket")}</strong></div>}
            {!pluginLoading && pluginCatalog.length > 0 && filteredPluginCatalog.length === 0 && <div className="empty-state"><Search size={28}/><strong>{t("noPluginMatches")}</strong></div>}
          </div>}
          {pluginTab === "mine" && <div className="plugin-market">
            {installedPlugins.map(plugin => <article className="panel plugin-card" key={plugin.id}>
              <div className="plugin-card-icon"><Puzzle size={20}/></div>
              <div className="plugin-card-copy">
                <div className="plugin-card-title"><h2>{plugin.name}</h2><span className="plugin-version">v{plugin.version}</span></div>
                <p>{plugin.description}</p>
                <div className="plugin-meta">{t("author")}: {plugin.author}</div>
                <div className="plugin-action-tags">{plugin.actions.map(action => <span key={action}>{t(action)}</span>)}</div>
              </div>
              <div className="plugin-card-buttons">
                <button className="button secondary small" disabled={pluginBusy === plugin.id} onClick={() => void togglePlugin(plugin)}><Power size={14}/>{plugin.enabled ? t("disable") : t("enable")}</button>
                <button className="button danger small" disabled={pluginBusy === plugin.id} onClick={() => void removePlugin(plugin.id)}><Trash2 size={14}/>{t("remove")}</button>
              </div>
            </article>)}
            {!pluginLoading && installedPlugins.length === 0 && <div className="empty-state"><Puzzle size={28}/><strong>{t("emptyMine")}</strong><button className="button primary small" onClick={() => setPluginTab("market")}>{t("marketTab")}</button></div>}
          </div>}
        </section>}

        {page === "about" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">{t("application")}</div><h1>{t("about")}</h1><p>{t("aboutSubtitle")}</p></div></div>
          <div className="panel about-hero"><img className="about-logo" src={logo} alt="Anti-AFK" /><div><h2>Anti-AFK</h2><p>{t("appSummary")}</p><span className="version-tag">v1.0.4</span></div></div>
          <div className="panel update-panel"><div className="panel-head"><div><h2>{t("updates")}</h2><p>{localizeUpdateMessage()}</p></div><Download size={19} className="muted-icon"/></div>
            {update.version && <div className="available-version">{t("availableVersion")}: <strong>{update.version}</strong></div>}
            <div className="update-actions"><button className="button secondary" onClick={() => window.antiAfk.checkUpdates()} disabled={update.status === "checking" || update.status === "downloading"}><RefreshCw size={15}/>{t("checkUpdates")}</button>
              {update.status === "available" && <button className="button primary" onClick={() => window.antiAfk.downloadUpdate()}><Download size={15}/>{t("install")}</button>}
              {update.status === "downloaded" && <button className="button primary" onClick={() => window.antiAfk.installUpdate()}>{t("installRestart")}</button>}</div>
            <div className="field-note">{t("updateSourceNote")}</div>
          </div>
          <button className="panel links-panel repository-link" onClick={() => window.antiAfk.openRepository()}><div className="link-row"><Github size={18}/><div><strong>{t("github")}</strong><span>{t("githubDescription")}</span></div><span className="muted">{t("openLink")} ↗</span></div></button>
          <button className="panel links-panel telegram-link" onClick={() => window.antiAfk.openTelegram()}><div className="telegram-mark">✈</div><div><strong>{t("telegram")}</strong><span>{t("telegramDescription")}</span></div><ExternalLink size={16}/></button>
        </section>}
      </main>
      {toast && <div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
      {pendingSetting && <div className="confirm-overlay" role="presentation">
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <span className="settings-icon"><SlidersHorizontal size={20}/></span>
          <h2 id="confirm-title">{t("confirmTitle")}</h2>
          <p>{t("confirmText")}</p>
          <div className="confirm-actions">
            <button className="button secondary" onClick={() => { pendingSetting.rollback(); setPendingSetting(null); notify(t("changeCancelled")); }}>{t("cancel")}</button>
            <button className="button primary" onClick={() => { setPendingSetting(null); notify(t("settingsSaved")); }}>{t("confirm")}</button>
          </div>
        </section>
      </div>}
      {pluginDetails && <div className="plugin-detail-overlay" role="presentation" onClick={() => setPluginDetails(null)}>
        <section className="plugin-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-detail-title" onClick={event => event.stopPropagation()}>
          <button className="plugin-detail-close" aria-label={t("close")} onClick={() => setPluginDetails(null)}><X size={18}/></button>
          <span className="plugin-icon"><Puzzle size={24}/></span>
          <span className="plugin-version">v{pluginDetails.version}</span>
          <h2 id="plugin-detail-title">{pluginDetails.name}</h2>
          <p>{pluginDetails.description}</p>
          <div className="plugin-meta">{t("author")}: {pluginDetails.author}</div>
          <strong className="plugin-detail-subtitle">{t("pluginActions")}</strong>
          <div className="plugin-action-tags">{pluginDetails.actions.map(action => <span key={action}>{t(action)}</span>)}</div>
          <p className="plugin-safe-detail">{t("pluginSafeNote")}</p>
          {!installedPlugins.some(plugin => plugin.id === pluginDetails.id) &&
            <button className="button primary" onClick={() => void installPlugin(pluginDetails.id)}><Download size={15}/>{t("installPlugin")}</button>}
        </section>
      </div>}
    </div>
  );
}
