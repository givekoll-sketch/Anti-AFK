import { useEffect, useState } from "react";
import { Clock3, X } from "lucide-react";
import { translate, type Language, type LocaleKey } from "./locales";
import "./overlay.css";

export default function Overlay() {
  const [status, setStatus] = useState({
    running: true,
    paused: false,
    message: "Подготавливаем таймер",
    lastActionAt: null as number | null,
    nextActionAt: null as number | null,
    intervalMs: 300000
  });
  const [now, setNow] = useState(Date.now());
  const [language, setLanguage] = useState<Language>("ru");

  useEffect(() => {
    document.documentElement.dataset.overlay = "true";
    void window.antiAfk.getStatus().then(setStatus);
    void window.antiAfk.loadSettings().then(settings => {
      if (settings?.language && ["ru", "en", "es", "pt", "ko", "ja", "zh", "pl"].includes(settings.language)) {
        setLanguage(settings.language);
      }
      if (typeof settings?.animations === "boolean") {
        document.documentElement.dataset.animations = String(settings.animations);
      }
    }).catch(error => console.error("Не удалось загрузить настройки таймера:", error));
    const offStatus = window.antiAfk.onStatus(setStatus);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      document.documentElement.dataset.overlay = "false";
      window.clearInterval(tick);
      offStatus();
    };
  }, []);

  const secondsLeft = status.nextActionAt
    ? Math.max(0, Math.ceil((status.nextActionAt - now) / 1000))
    : null;
  const timer = secondsLeft === null
    ? "--:--"
    : `${Math.floor(secondsLeft / 60).toString().padStart(2, "0")}:${(secondsLeft % 60).toString().padStart(2, "0")}`;
  const progress = secondsLeft === null
    ? 0
    : Math.max(0, Math.min(100, (secondsLeft * 1000 / Math.max(status.intervalMs, 1000)) * 100));
  const statusKeys: Record<string, LocaleKey> = {
    "Ожидаем фокус Minecraft — переключитесь в игру": "statusWaitingFocus",
    "Запущено — ожидаем фокус Minecraft": "statusWaitingFocus",
    "Действие выполнено": "statusActive",
    "Не удалось выполнить действие": "statusError",
    "Окно Minecraft больше недоступно — выберите его заново": "statusTargetLost",
    "Ожидание запуска": "statusIdle",
    "Пауза": "paused",
    "Работа продолжена": "working",
    "Остановлено": "notRunning"
  };
  const statusKey = statusKeys[status.message];
  const statusLabel = statusKey ? translate(language, statusKey) : status.message;

  return (
    <main className="action-overlay" aria-label="Таймер Anti-AFK">
      <header className="overlay-header">
        <span><span className={`overlay-led ${status.paused ? "paused" : ""}`} />ANTI-AFK</span>
        <button className="overlay-close" onClick={() => void window.antiAfk.closeOverlay()} aria-label={translate(language, "closeTimer")}>
          <X size={14} />
        </button>
      </header>
      <div className="overlay-timer">
        <Clock3 size={18} />
        <strong>{status.paused ? translate(language, "overlayPaused") : timer}</strong>
        <span>{status.paused ? translate(language, "overlayPaused") : translate(language, "timeToAction")}</span>
      </div>
      <div className="overlay-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="overlay-message">{statusLabel || translate(language, "preparingTimer")}</div>
    </main>
  );
}
