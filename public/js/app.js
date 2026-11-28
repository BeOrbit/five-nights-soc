/**
 * App shell: the entry point loaded by index.html.
 *
 * Owns everything that isn't a single night: the main menu and shift roster
 * (including which nights are unlocked), the How to Play memo, credits,
 * settings, and the taskbar's Log off and "?" buttons. Each night lives in
 * its own module and exposes init(), load(), and a few hooks.
 */

import { getNightBest } from "./storage.js";
import { initSettings } from "./settings.js";
import { $, el, signed } from "./ui.js";
import { sortRanks } from "./ranks.js";
import { showScreen } from "./screens.js";
import * as night1 from "./night1.js";
import * as night2 from "./night2.js";

let night1Ready = false;
let night2Ready = false;
let night2Failed = false;

/* ---------- Unlocks ---------- */

/** Night 1 is always open; each later night opens once the one before it has a saved result. */
export function isNightUnlocked(night) {
  return night <= 1 || getNightBest(night - 1) !== null;
}

/* ---------- Main menu ---------- */

function renderNight1Row() {
  const best = getNightBest(1);
  $("menu-best").hidden = !best;
  $("menu-best").textContent = best ? `Best: ${best.bestXp} XP, ${best.bestRank}` : "";
  if (!night1Ready) return;
  const start = $("menu-start-btn");
  start.textContent = "Start Night 1";
  start.disabled = false;
}

/** Night 2's row: locked until Night 1 has a saved result. */
function renderNight2Row() {
  const unlocked = isNightUnlocked(2);
  const row = $("roster-n2");
  row.classList.toggle("is-open", unlocked);
  row.classList.toggle("is-locked", !unlocked);
  if (unlocked) row.removeAttribute("aria-disabled");
  else row.setAttribute("aria-disabled", "true");

  const status = $("roster-n2-status");
  status.textContent = unlocked ? "Cleared" : "Locked";
  status.className = `tag ${unlocked ? "tag-ok" : "tag-locked"}`;
  let sub = "Clearance pending: complete Night 1";
  if (unlocked) sub = night2Failed ? "Couldn't reach the server. Refresh to try again." : "Forensic terminal · 12:00 AM to 6:00 AM";
  $("roster-n2-sub").textContent = sub;

  const best = unlocked ? getNightBest(2) : null;
  $("menu-n2-best").hidden = !best;
  $("menu-n2-best").textContent = best ? `Best: ${best.bestXp} XP, ${best.bestRank}` : "";

  const start = $("menu-n2-btn");
  start.hidden = !unlocked;
  start.disabled = !night2Ready;
  start.textContent = night2Ready ? "Start Night 2" : night2Failed ? "Unavailable" : "Loading…";
}

function renderMenu() {
  renderNight1Row();
  renderNight2Row();
}

function showMenu() {
  renderMenu();
  showScreen("menu");
  $("menu-start-btn").focus({ preventScroll: true });
}

/* ---------- How to Play memo ---------- */

/** Fill the memo's scoring and rank tables from Night 1's config, so they never go stale. */
function renderMemo({ xp, ranks }) {
  const rows = [
    ["Correct call", xp.correctCall],
    ["Each real red flag you flag", xp.redFlagFound],
    ["Each thing you flag that isn't a red flag", xp.falseFlag],
    ["Wrong call", xp.wrongCall],
  ];
  $("memo-xp").replaceChildren(
    ...rows.map(([label, value]) => el("tr", {}, [el("td", { text: label }), el("td", { text: `${signed(value)} XP` })])),
  );
  $("memo-ranks").replaceChildren(
    ...sortRanks(ranks).map((r) =>
      el("tr", {}, [
        el("td", { text: r.name }),
        el("td", { text: r.minPercent === 0 ? "Starting rank" : `${r.minPercent}% or more` }),
      ]),
    ),
  );
}

/** Night 2's part of the memo: clock cost and scoring, from Night 2's config. */
function renderMemoNight2({ xp, minutesPerCommand, shiftStartHour, shiftEndHour }) {
  $("memo-n2-minutes").textContent = String(minutesPerCommand);
  $("memo-n2-commands").textContent = String(((shiftEndHour - shiftStartHour) * 60) / minutesPerCommand);
  const rows = [
    ["Correct answer", xp.correctAnswer],
    ["Wrong or blank answer", xp.wrongAnswer],
    ["Each key piece of evidence found", xp.clueFound],
  ];
  $("memo-n2-xp").replaceChildren(
    ...rows.map(([label, value]) => el("tr", {}, [el("td", { text: label }), el("td", { text: `${signed(value)} XP` })])),
  );
}

/* ---------- Taskbar ---------- */

/** Taskbar "Log off": confirm first if a shift is under way. */
function requestLogoff() {
  if (night1.isShiftInProgress() || night2.isShiftInProgress()) $("logoff-dialog").showModal();
  else showMenu();
}

/** Taskbar "?": reopen the handoff for whichever night is on screen. */
function openHelp() {
  if (night2.isShiftInProgress()) night2.openHelp();
  else night1.openBriefingDialog();
}

/** After "Reset progress", forget best scores everywhere and lock later nights again. */
function onProgressReset() {
  night1.onProgressReset();
  night2.onProgressReset();
  renderMenu();
}

/* ---------- Setup ---------- */

function bindEvents() {
  $("menu-start-btn").addEventListener("click", night1.openBriefing);
  $("menu-n2-btn").addEventListener("click", () => {
    if (isNightUnlocked(2)) night2.openBriefing();
  });
  $("menu-howto-btn").addEventListener("click", () => {
    showScreen("howto");
    $("howto-back-btn").focus({ preventScroll: true });
  });
  $("menu-settings-btn").addEventListener("click", () => $("settings-btn").click());
  $("menu-credits-btn").addEventListener("click", () => $("credits-dialog").showModal());
  $("credits-close").addEventListener("click", () => $("credits-dialog").close());
  $("howto-back-btn").addEventListener("click", showMenu);

  $("logoff-btn").addEventListener("click", requestLogoff);
  $("logoff-cancel").addEventListener("click", () => $("logoff-dialog").close());
  $("logoff-confirm").addEventListener("click", () => {
    $("logoff-dialog").close();
    showMenu();
  });
  $("help-btn").addEventListener("click", openHelp);

  // Clicking the dark backdrop closes a dialog, like pressing Escape.
  for (const id of ["credits-dialog", "logoff-dialog"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target === $(id)) $(id).close();
    });
  }

  initSettings({ onReset: onProgressReset });
}

async function init() {
  bindEvents();
  night1.init({ onExit: showMenu });
  night2.init({ onExit: showMenu });
  showScreen("menu");
  renderMenu();

  // Load both nights at once; one failing doesn't block the other.
  const [first, second] = await Promise.allSettled([night1.load(), night2.load()]);
  if (first.status === "fulfilled") {
    night1Ready = true;
    renderMemo(first.value.config);
  } else {
    console.error("Failed to load Night 1:", first.reason);
    $("menu-start-btn").textContent = "Unavailable";
    const msg = $("load-error");
    msg.textContent = "Couldn't reach the shift schedule. Refresh the page to try again.";
    msg.hidden = false;
  }
  if (second.status === "fulfilled") {
    night2Ready = true;
    renderMemoNight2(second.value.config);
  } else {
    console.error("Failed to load Night 2:", second.reason);
    night2Failed = true;
  }
  renderMenu();
}

init();
