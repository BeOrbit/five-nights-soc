/**
 * Settings menu: sound, reduce motion, larger text, and resetting progress.
 *
 * Settings are saved in localStorage (see storage.js) and applied as classes
 * on <html>, so the CSS does the real work.
 */

import { clearProgress, loadSettings, saveSettings } from "./storage.js";
import { play, setSoundEnabled } from "./sound.js";

const $ = (id) => document.getElementById(id);

let settings = loadSettings();

function apply() {
  const root = document.documentElement;
  root.classList.toggle("reduce-motion", settings.reduceMotion);
  root.classList.toggle("large-text", settings.largeText);
  setSoundEnabled(settings.sound);
}

/** True if animations should play (respects both the setting and the OS preference). */
export function motionOK() {
  if (settings.reduceMotion) return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior() {
  return motionOK() ? "smooth" : "auto";
}

/**
 * Wire up the settings dialog and the reset confirmation.
 * `onReset` runs after saved progress is cleared, so the page can update.
 */
export function initSettings({ onReset } = {}) {
  apply();

  const dialog = $("settings-dialog");
  const openBtn = $("settings-btn");
  const status = $("settings-status");
  const inputs = {
    sound: $("setting-sound"),
    reduceMotion: $("setting-motion"),
    largeText: $("setting-text"),
  };

  for (const [key, input] of Object.entries(inputs)) {
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings = { ...settings, [key]: input.checked };
      apply();
      const saved = saveSettings(settings);
      status.textContent = saved ? "" : "Settings changed, but this browser won't let the game save them.";
      if (key === "sound" && input.checked) play("flag"); // a quick preview
    });
  }

  openBtn.addEventListener("click", () => {
    status.textContent = "";
    dialog.showModal();
    openBtn.setAttribute("aria-expanded", "true");
  });
  dialog.addEventListener("close", () => openBtn.setAttribute("aria-expanded", "false"));
  $("settings-close").addEventListener("click", () => dialog.close());

  // Reset progress: always behind a second, explicit confirmation.
  const confirmDialog = $("reset-dialog");
  $("reset-btn").addEventListener("click", () => confirmDialog.showModal());
  $("reset-cancel").addEventListener("click", () => confirmDialog.close());
  $("reset-confirm").addEventListener("click", () => {
    const ok = clearProgress();
    confirmDialog.close();
    status.textContent = ok
      ? "Progress reset. Your saved XP and best scores are gone."
      : "Couldn't reset: this browser is blocking saved data.";
    if (ok) onReset?.();
    $("reset-btn").focus();
  });

  // Clicking the dark backdrop closes either dialog, like pressing Escape.
  for (const d of [dialog, confirmDialog]) {
    d.addEventListener("click", (event) => {
      if (event.target === d) d.close();
    });
  }
}
