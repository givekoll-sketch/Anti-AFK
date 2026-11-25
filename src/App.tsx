import { useEffect, useMemo, useState } from "react";
import {
  Activity, Gamepad2, House, Info, Keyboard, Moon, Sun, Monitor,
  RefreshCw, Play, Square, Pause, ChevronDown, CheckCircle2, AlertCircle,
  Clock3, RotateCw, Footprints, ArrowUp, Download, Github, ScrollText,
  SlidersHorizontal, Puzzle, Languages, Palette, Sparkles, ExternalLink, LockKeyhole
} from "lucide-react";
import logoSmall from "../assets/logo-small.png";
import logo from "../assets/logo.png";
import "./feature-pages.css";
import "./update-banner.css";

type MinecraftWindow = { id: string; title: string; processName: string; pid: number };
type ActionName = "camera" | "jump" | "walk";
type UpdateState = {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "error";
  message: string;
  version?: string;
};
type PageId = "home" | "keys" | "log" | "settings" | "plugins" | "about";
type AppLogEntry = { timestamp: string; level: "info" | "warning" | "error"; message: string };
const actionInfo: { id: ActionName; title: string; desc: string; icon: any }[] = [
  { id: "camera", title: "Поворот камеры", desc: "Небольшое движение мыши в обе стороны", icon: RotateCw },
  { id: "jump", title: "Прыжок", desc: "Короткое нажатие клавиши прыжка", icon: ArrowUp },
  { id: "walk", title: "Ходьба", desc: "Короткое движение вперёд", icon: Footprints }
];

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [windows, setWindows] = useState<MinecraftWindow[]>([]);
  const [selected, setSelected] = useState("");
  const [actions, setActions] = useState<ActionName[]>(["camera", "jump"]);
  const [interval, setIntervalValue] = useState("5");
  const [unit, setUnit] = useState<"seconds" | "minutes" | "hours">("minutes");
  const [status, setStatus] = useState({ running: false, paused: false, message: "Ожидание запуска", lastActionAt: null as number | null });
  const [update, setUpdate] = useState<UpdateState>({ status: "idle", message: "Проверка ещё не выполнялась" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [skipUpdateWarning, setSkipUpdateWarning] = useState(false);
  const [decliningUpdate, setDecliningUpdate] = useState(false);
  const [updatePromptDismissed, setUpdatePromptDismissed] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [confirmTheme, setConfirmTheme] = useState<"dark" | "light" | null>(null);
  const [toast, setToast] = useState("");
  const selectedWindow = useMemo(() => windows.find(w => w.id === selected), [windows, selected]);

  useEffect(() => {
    window.antiAfk.loadSettings().then(saved => {
      if (!saved) return;
      if (saved.theme) setTheme(saved.theme);
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
    if (!settingsLoaded) return;
    window.antiAfk.saveSettings({ theme, actions, interval, unit, selected, skipUpdateWarning })
      .catch(() => notify("Не удалось сохранить настройки"));
  }, [theme, actions, interval, unit, selected, skipUpdateWarning, settingsLoaded]);

  async function scanWindows() {
    setDetecting(true);
    try {
      const found = await window.antiAfk.detectWindows();
      setWindows(found);
      if (found.length && !found.some(w => w.id === selected)) setSelected(found[0].id);
      if (!found.length) setToast("Окна Minecraft не найдены");
    } catch {
      setToast("Не удалось выполнить поиск окон");
    } finally { setDetecting(false); }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function start() {
    if (!selectedWindow) return notify("Сначала выберите окно Minecraft");
    if (!actions.length) return notify("Выберите хотя бы одно действие");
    const n = Math.max(5, Number(interval) || 5);
    const multiplier = unit === "seconds" ? 1000 : unit === "minutes" ? 60000 : 3600000;
    const result = await window.antiAfk.start({
      target: selectedWindow, actions, intervalMs: n * multiplier
    });
    notify(result.message);
  }

  const nav = [
    { id: "home" as const, label: "Главная", icon: House },
    { id: "keys" as const, label: "Горячие клавиши", icon: Keyboard },
    { id: "log" as const, label: "Лог действий", icon: ScrollText },
    { id: "settings" as const, label: "Настройки", icon: SlidersHorizontal },
    { id: "plugins" as const, label: "Плагины", icon: Puzzle },
    { id: "about" as const, label: "О программе", icon: Info }
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

  function chooseTheme(nextTheme: "dark" | "light") {
    if (theme === nextTheme) return;
    setTheme(nextTheme);
    setConfirmTheme(nextTheme);
  }

  function cancelThemeChange() {
    if (confirmTheme) setTheme(confirmTheme === "dark" ? "light" : "dark");
    setConfirmTheme(null);
    notify("Изменение темы отменено");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src={logoSmall} alt="" /></div>
          <div><div className="brand-name">ANTI-AFK</div><div className="brand-sub">Minecraft utility</div></div>
        </div>
        <div className="nav-caption">МЕНЮ</div>
        <nav className="sidebar-nav">{nav.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => {
            setPage(item.id);
            if (item.id === "plugins") notify("Плагины выведены в beta test");
          }}>
            <span className="nav-icon"><Icon size={18} /></span><span>{item.label}</span>
          </button>;
        })}</nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className={`status-dot ${status.running ? "on" : ""}`} /><span>{status.running ? (status.paused ? "На паузе" : "Работает") : "Не запущено"}</span></div>
          <div className="version">ANTI-AFK · v1.0.2</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">Anti-AFK <span>/</span> {nav.find(n => n.id === page)?.label}</div>
          <div className="topbar-status"><span className={`status-dot ${status.running ? "on" : ""}`} />{status.running ? (status.paused ? "Пауза" : "Работает") : "Готов к работе"}</div>
        </header>

        {showUpdateBanner && <section className={`update-banner ${decliningUpdate ? "warning" : ""}`} aria-live="polite">
          <div className="update-banner-copy">
            <strong>{decliningUpdate
              ? "Вы отказались от обновления"
              : update.status === "available"
                ? `Доступно новое обновление (${update.version})`
                : update.status === "downloaded"
                  ? `Обновление ${update.version} готово`
                  : `Загружаем обновление ${update.version ?? ""}`}</strong>
            <p>{decliningUpdate
              ? "При отказе вы не получите новые функции, а мы не гарантируем безопасность старых версий."
              : update.status === "available"
                ? "Установите обновление, чтобы получить новые функции и исправления."
                : update.message}</p>
            {decliningUpdate && <label className="update-warning-option">
              <input
                type="checkbox"
                checked={skipUpdateWarning}
                onChange={event => setSkipUpdateWarning(event.target.checked)}
              />
              Не показывать это сообщение больше
            </label>}
          </div>
          <div className="update-banner-actions">
            {decliningUpdate ? <>
              <button className="button secondary" onClick={acknowledgeDecline}>Соглашаюсь</button>
              <button className="button primary" onClick={downloadUpdate}><Download size={15}/>Установить</button>
            </> : update.status === "available" ? <>
              <button className="button primary" onClick={downloadUpdate}><Download size={15}/>Установить</button>
              <button className="button secondary" onClick={declineUpdate}>Отменить</button>
            </> : update.status === "downloaded" ? <>
              <button className="button primary" onClick={() => window.antiAfk.installUpdate()}>Перезапустить и установить</button>
              <button className="button secondary" onClick={() => setUpdatePromptDismissed(true)}>Позже</button>
            </> : <button className="button secondary" disabled>{update.message}</button>}
          </div>
        </section>}

        {page === "home" && <section className="page">
          <div className="page-heading">
            <div><div className="eyebrow">УПРАВЛЕНИЕ</div><h1>Главная</h1><p>Настройте автоматические действия для выбранного клиента Minecraft.</p></div>
            <div className={`running-pill ${status.running ? "running" : ""}`}><span className="status-dot" />{status.running ? (status.paused ? "Пауза" : "Активно") : "Остановлено"}</div>
          </div>

          <div className="panel window-panel">
            <div className="panel-head"><div className="panel-title"><div className="icon-tile"><Monitor size={18}/></div><div><h2>Окно Minecraft</h2><p>Выберите клиент, с которым будет работать программа</p></div></div>
              <button className="button secondary small" onClick={scanWindows} disabled={detecting}><RefreshCw size={15} className={detecting ? "spin" : ""}/>{detecting ? "Поиск..." : "Обновить"}</button>
            </div>
            <div className="select-wrap"><Gamepad2 size={18}/><select value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">Выберите обнаруженное окно</option>
              {windows.map(w => <option value={w.id} key={w.id}>{w.title} · {w.processName} · PID {w.pid}</option>)}
            </select><ChevronDown size={16}/></div>
            <div className="window-foot"><span className={`status-dot ${selectedWindow ? "on" : ""}`}/>{selectedWindow ? `Обнаружено: ${selectedWindow.processName} (PID ${selectedWindow.pid})` : "Окно не выбрано"}<span className="muted">Поддержка Java и Bedrock</span></div>
          </div>

          <div className="content-grid">
            <div className="panel actions-panel">
              <div className="panel-head"><div><h2>Действия</h2><p>Что выполнять во время активности</p></div><span className="counter">{actions.length} выбрано</span></div>
              <div className="action-list">{actionInfo.map(a => {
                const Icon = a.icon; const checked = actions.includes(a.id);
                return <button key={a.id} className={`action-row ${checked ? "checked" : ""}`} onClick={() => setActions(old => checked ? old.filter(x => x !== a.id) : [...old, a.id])}>
                  <div className="action-icon"><Icon size={18}/></div><div className="action-copy"><strong>{a.title}</strong><span>{a.desc}</span></div>
                  <span className={`switch ${checked ? "enabled" : ""}`}><i/></span>
                </button>;
              })}</div>
              <div className="hint"><AlertCircle size={15}/> Действия выполняются только когда выбранное окно Minecraft активно.</div>
            </div>

            <div className="right-stack">
              <div className="panel interval-panel">
                <div className="panel-head"><div><h2>Интервал</h2><p>Пауза между циклами действий</p></div><Clock3 size={18} className="muted-icon"/></div>
                <div className="interval-controls"><input type="number" min="5" value={interval} onChange={e => setIntervalValue(e.target.value)} /><select value={unit} onChange={e => setUnit(e.target.value as any)}><option value="seconds">Секунды</option><option value="minutes">Минуты</option><option value="hours">Часы</option></select></div>
                <div className="field-note">Минимальный интервал — 5 секунд.</div>
              </div>
              <div className="panel run-panel">
                <div className="panel-head"><div><h2>Управление</h2><p>{status.message}</p></div><Activity size={18} className="muted-icon"/></div>
                <div className="run-buttons">
                  {!status.running ? <button className="button primary" onClick={start}><Play size={16} fill="currentColor"/>Запустить</button> :
                    <button className="button secondary" onClick={() => window.antiAfk.pause()}><Pause size={16}/>{status.paused ? "Продолжить" : "Пауза"}</button>}
                  <button className="button danger" onClick={() => window.antiAfk.stop()} disabled={!status.running}><Square size={15} fill="currentColor"/>Стоп</button>
                </div>
                <div className="hotkey-line"><span>Быстрое управление</span><div><kbd>F6</kbd><kbd>F7</kbd><kbd>F8</kbd></div></div>
              </div>
            </div>
          </div>
          <div className="panel activity-panel"><div className="activity-label"><span className="status-dot" />СОСТОЯНИЕ</div><div className="activity-message">{status.message}</div><div className="activity-time">{status.lastActionAt ? `Последнее действие: ${new Date(status.lastActionAt).toLocaleTimeString()}` : "Действия ещё не выполнялись"}</div></div>
        </section>}

        {page === "keys" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ</div><h1>Горячие клавиши</h1><p>Глобальные сочетания работают, даже когда Anti-AFK свёрнут.</p></div></div>
          <div className="panel keys-panel">
            {[["Запуск","F6","Запускает сохранённую конфигурацию после первого старта"],["Остановка","F7","Немедленно останавливает цикл действий"],["Пауза / продолжить","F8","Временно приостанавливает или возобновляет действия"]].map(([name,key,desc]) => <div className="key-row" key={key}><div><strong>{name}</strong><span>{desc}</span></div><kbd>{key}</kbd></div>)}
            <div className="hint"><Info size={15}/> В первой версии используются стандартные клавиши. Переназначение добавим в следующем обновлении.</div>
          </div>
        </section>}

        {page === "log" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">ДИАГНОСТИКА</div><h1>Лог действий</h1><p>История событий и ошибок Anti-AFK на этом устройстве.</p></div><span className="counter">{logs.length} записей</span></div>
          <div className="panel log-panel">
            {logs.length ? <div className="log-list">{logs.map((entry, index) => <article className={`log-entry log-${entry.level}`} key={`${entry.timestamp}-${index}`}>
              <span className="log-level">{entry.level === "error" ? "ОШИБКА" : entry.level === "warning" ? "ВНИМАНИЕ" : "СОБЫТИЕ"}</span>
              <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
              <p>{entry.message}</p>
            </article>)}</div> : <div className="empty-state"><ScrollText size={28}/><strong>Пока нет записей</strong><span>Здесь появятся действия и ошибки приложения.</span></div>}
          </div>
          <p className="field-note">Журнал хранится локально на вашем устройстве.</p>
        </section>}

        {page === "settings" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">ПЕРСОНАЛИЗАЦИЯ</div><h1>Настройки</h1><p>Выберите, как Anti-AFK будет выглядеть и работать.</p></div></div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Sun size={18}/></span><div><h2>Тема приложения</h2><p>Переключение применяется сразу; подтвердите изменение в окне.</p></div></div>
            <div className="choice-row theme-choices">
              <button className={`choice-chip ${theme === "light" ? "selected" : ""}`} onClick={() => chooseTheme("light")}><Sun size={15}/>Светлая</button>
              <button className={`choice-chip ${theme === "dark" ? "selected" : ""}`} onClick={() => chooseTheme("dark")}><Moon size={15}/>Тёмная</button>
            </div>
          </div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Languages size={18}/></span><div><h2>Язык</h2><p>Язык интерфейса</p></div><span className="coming-tag"><LockKeyhole size={12}/>v1.0.2.2</span></div>
            <div className="choice-grid language-choices" aria-disabled="true">
              {[
                ["🇷🇺", "Русский"], ["🇺🇸", "English"], ["🇪🇸", "Español"], ["🇵🇹", "Português"],
                ["🇰🇷", "한국어"], ["🇯🇵", "日本語"], ["🇨🇳", "中文"], ["🇵🇱", "Polski"]
              ].map(([flag, label]) => <button className={`choice-chip ${label === "Русский" ? "selected" : ""}`} key={label} disabled title="Доступно в версии v1.0.2.2"><span>{flag}</span>{label}</button>)}
            </div>
          </div>
          <div className="panel settings-card">
            <div className="settings-section-head"><span className="settings-icon"><Palette size={18}/></span><div><h2>Стиль интерфейса</h2><p>Выберите оформление приложения</p></div><span className="coming-tag"><LockKeyhole size={12}/>v1.0.2.2</span></div>
            <div className="choice-grid style-choices" aria-disabled="true">
              {[
                ["minecraft", "Minecraft", "Пиксельный стиль"],
                ["oled", "OLED", "Глубокий чёрный"],
                ["nether", "Незер", "Багровые оттенки"],
                ["end", "Энд", "Сумеречная палитра"]
              ].map(([id, label, description]) => <button className={`style-chip style-${id}`} key={id} disabled title="Доступно в версии v1.0.2.2"><span className="style-swatch"/><strong>{label}</strong><small>{description}</small></button>)}
            </div>
          </div>
          <div className="panel settings-card animation-setting">
            <div className="settings-section-head"><span className="settings-icon"><Sparkles size={18}/></span><div><h2>Анимации</h2><p>Включение и отключение анимации интерфейса</p></div><span className="coming-tag"><LockKeyhole size={12}/>v1.0.2.2</span></div>
            <button className="switch-row" disabled title="Доступно в версии v1.0.2.2"><span>Анимации включены</span><span className="switch enabled"><i/></span></button>
          </div>
          <div className="hint settings-roadmap"><Info size={15}/> Язык, стили и анимации станут доступны в версии <strong>v1.0.2.2</strong>. При выборе настройки будут применяться сразу с подтверждением.</div>
        </section>}

        {page === "plugins" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">РАСШИРЕНИЯ</div><h1>Плагины</h1><p>Дополнительные возможности для Anti-AFK.</p></div><span className="coming-tag beta-tag">BETA</span></div>
          <div className="panel plugin-beta">
            <span className="plugin-icon"><Puzzle size={24}/></span>
            <h2>Плагины выведены в beta test</h2>
            <p>Раздел открыт для предварительного просмотра. Подключение плагинов появится в будущей версии.</p>
            <span className="version-tag">Следите за обновлениями</span>
          </div>
        </section>}

        {page === "about" && <section className="page">
          <div className="page-heading"><div><div className="eyebrow">ПРИЛОЖЕНИЕ</div><h1>О программе</h1><p>Информация о версии и обновлениях Anti-AFK.</p></div></div>
          <div className="panel about-hero"><img className="about-logo" src={logo} alt="Логотип Anti-AFK" /><div><h2>Anti-AFK</h2><p>Помощник активности для Minecraft</p><span className="version-tag">Версия 1.0.2</span></div></div>
          <div className="panel update-panel"><div className="panel-head"><div><h2>Обновления</h2><p>{update.message}</p></div><Download size={19} className="muted-icon"/></div>
            {update.version && <div className="available-version">Доступная версия: <strong>{update.version}</strong></div>}
            <div className="update-actions"><button className="button secondary" onClick={() => window.antiAfk.checkUpdates()} disabled={update.status === "checking" || update.status === "downloading"}><RefreshCw size={15}/>Проверить обновления</button>
              {update.status === "available" && <button className="button primary" onClick={() => window.antiAfk.downloadUpdate()}><Download size={15}/>Установить</button>}
              {update.status === "downloaded" && <button className="button primary" onClick={() => window.antiAfk.installUpdate()}>Установить и перезапустить</button>}</div>
            <div className="field-note">Новые версии публикуются в GitHub Releases и устанавливаются прямо из приложения.</div>
          </div>
          <button className="panel links-panel repository-link" onClick={() => window.antiAfk.openRepository()}><div className="link-row"><Github size={18}/><div><strong>Проект на GitHub</strong><span>Исходный код, релизы и история изменений</span></div><span className="muted">Открыть <span aria-hidden="true">↗</span></span></div></button>
          <button className="panel links-panel telegram-link" onClick={() => window.antiAfk.openTelegram()}><div className="telegram-mark">✈</div><div><strong>Наш новостной телеграмм канал</strong><span>Новости и анонсы Anti-AFK</span></div><ExternalLink size={16}/></button>
        </section>}
      </main>
      {toast && <div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
      {confirmTheme && <div className="confirm-overlay" role="presentation">
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <span className="settings-icon">{confirmTheme === "dark" ? <Moon size={20}/> : <Sun size={20}/>}</span>
          <h2 id="confirm-title">Подтвердите изменение</h2>
          <p>Тема «{confirmTheme === "dark" ? "Тёмная" : "Светлая"}» уже применена. Оставить этот выбор?</p>
          <div className="confirm-actions">
            <button className="button secondary" onClick={cancelThemeChange}>Отменить</button>
            <button className="button primary" onClick={() => { setConfirmTheme(null); notify("Тема сохранена"); }}>Подтвердить</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
