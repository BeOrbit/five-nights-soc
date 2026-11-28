/**
 * Screen switching and the taskbar, shared by every night.
 *
 * Each screen is a <section id="screen-NAME">. The taskbar shows the active
 * "window" title, and the shift tray (XP, rank, progress) only appears while
 * a shift is under way.
 */

import { $ } from "./ui.js";

const SCREENS = {
  menu: { task: "Logon: SOC-WS-07" },
  howto: { task: "KL-SOC-MEMO-0412.txt" },
  briefing: { task: "Handoff Log", shift: true },
  inbox: { task: "Mail Triage: SOC Queue", shift: true, help: true },
  results: { task: "End of Shift Report", shift: true },
  "n2-briefing": { task: "Handoff Log: KL-IR-2026-0047", shift: true },
  terminal: { task: "SSH: soc-analyst@kl-rpt-01", shift: true, help: true },
  "n2-results": { task: "End of Shift Report: KL-IR-2026-0047", shift: true },
};

const listeners = [];

/** Run `fn(name)` before every screen change (for example, to close a tooltip). */
export function onScreenChange(fn) {
  listeners.push(fn);
}

export function showScreen(name) {
  const info = SCREENS[name];
  if (!info) throw new Error(`Unknown screen: ${name}`);
  for (const fn of listeners) fn(name);
  for (const screen of Object.keys(SCREENS)) $(`screen-${screen}`).hidden = screen !== name;
  $("help-btn").hidden = !info.help;
  $("logoff-btn").hidden = name === "menu";
  $("tray-shift").hidden = !info.shift;
  $("task-window").textContent = info.task;
  window.scrollTo(0, 0);
}

export function isScreenVisible(name) {
  return !$(`screen-${name}`).hidden;
}
