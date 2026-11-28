/**
 * Night 2: the terminal.
 *
 * Driven by data/night2.json: the server's files, logs, clues, scoring, and
 * clock all come from there. This file runs the handoff screen and the
 * investigation screen: it passes each command to the simulated shell
 * (terminal/shell.js), prints the results, moves the clock, and logs
 * evidence as the player turns it up.
 *
 * The player fills in the case file (casefile.js) beside the terminal and
 * files it, or it's filed as is at 6:00 AM. Answers are checked against
 * SHA-256 hashes (answers.js), then the end-of-shift report shows each
 * answer, the attack timeline, and recommendations.
 *
 * Security note: the shell never executes anything; see shell.js. All text
 * reaches the page through textContent.
 */

import { getNightBest, saveNightResult } from "./storage.js";
import { play } from "./sound.js";
import { $, el, tag, formatClock, plural, signed } from "./ui.js";
import { gradeCaseFile, caseFileXp } from "./answers.js";
import { createCaseFile, describeResponse } from "./casefile.js";
import { rankFor } from "./ranks.js";
import { showScreen, isScreenVisible } from "./screens.js";
import { createShell, matchClues } from "./terminal/shell.js";
import { createTerminal } from "./terminal/terminal.js";

const NIGHT = 2;
const DATA_URL = "data/night2.json";

let exitToMenu = () => {};
let terminal = null;
let caseFile = null;

const state = {
  data: null,
  config: null,
  shell: null,
  minutes: 0,
  xp: 0,
  commands: 0,
  found: [], // clue ids, in the order found
  auditSeen: false, // read the shell audit policy (debrief only, no XP)
  warned: new Set(), // clock warnings already shown
  over: false, // the case file has been filed; the session is closed
};

/* ---------- Derived values (all from config) ---------- */

function shiftMinutes() {
  const { shiftStartHour, shiftEndHour } = state.config;
  return (shiftEndHour - shiftStartHour) * 60;
}

function minutesLeft() {
  return Math.max(0, shiftMinutes() - state.minutes);
}

function commandsLeft() {
  return Math.floor(minutesLeft() / state.config.minutesPerCommand);
}

function shiftClock(minutes = state.minutes) {
  return formatClock(state.config.shiftStartHour * 60 + minutes);
}

function maxPossibleXp() {
  const { xp } = state.config;
  return state.data.clues.length * xp.clueFound + state.data.caseFile.length * xp.correctAnswer;
}

/** Does this command cost clock time? Unknown commands and a few reference commands are free. */
function isCharged(result) {
  const name = result.input.trim().split(/\s+/)[0];
  if (state.config.freeCommands.includes(name)) return false;
  return result.known || state.config.chargeUnknownCommands === true;
}

/* ---------- HUD (taskbar tray) ---------- */

function updateHud({ bump = false } = {}) {
  const total = state.data.clues.length;
  const done = state.found.length;
  $("hud-clock").textContent = shiftClock();
  $("hud-progress-text").textContent = `${done} of ${total} evidence found`;
  const bar = $("hud-progress");
  bar.setAttribute("aria-label", "Evidence found");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  $("hud-progress-fill").style.width = `${total ? (done / total) * 100 : 0}%`;

  const xpNode = $("hud-xp");
  xpNode.textContent = String(state.xp);
  $("hud-rank").textContent = rankFor(state.xp, maxPossibleXp(), state.config.ranks);
  if (bump) {
    xpNode.classList.remove("xp-bump");
    void xpNode.offsetWidth; // restart the animation
    xpNode.classList.add("xp-bump");
  }
}

function updateSession() {
  const left = commandsLeft();
  $("session-commands").textContent = String(state.commands);
  $("session-left").textContent = String(left);
  $("session-time").textContent = shiftClock();
  $("term-status-left").textContent = state.over ? "Session closed" : `${plural(left, "command")} left`;
}

/* ---------- Evidence log ---------- */

function updateTabCounts() {
  $("tab-evidence-count").textContent = `${state.found.length}/${state.data.clues.length}`;
  $("tab-casefile-count").textContent = `${caseFile.filledCount()}/${state.data.caseFile.length}`;
}

function renderEvidence() {
  const byId = new Map(state.data.clues.map((c) => [c.id, c]));
  $("evidence-list").replaceChildren(
    ...state.found.map(({ id, at }) =>
      el("li", { className: "evidence-item" }, [el("span", { className: "evidence-time mono", text: at }), el("span", { text: byId.get(id).label })]),
    ),
  );
  $("evidence-empty").hidden = state.found.length > 0;
  updateTabCounts();
}

/** Log any new clues this command revealed. Returns the lines to print about them. */
function logClues(result) {
  const { xp } = state.config;
  const byId = new Map(state.data.clues.map((c) => [c.id, c]));
  if (!state.auditSeen) state.auditSeen = matchClues(result, [{ id: "audit", match: state.data.debrief.audit.match }]).length > 0;
  const fresh = matchClues(result, state.data.clues).filter((id) => !state.found.some((f) => f.id === id));
  if (!fresh.length) return [];
  for (const id of fresh) {
    state.found.push({ id, at: shiftClock() });
    state.xp += xp.clueFound;
  }
  renderEvidence();
  play("correct");
  return fresh.map((id) => ({ text: `[+] Evidence logged: ${byId.get(id).label} (+${xp.clueFound} XP)`, kind: "clue" }));
}

/* ---------- Clock ---------- */

/** Warn as the shift runs low (thresholds come from config). */
function clockWarnings() {
  const lines = [];
  for (const threshold of state.config.clockWarningsMinutesLeft) {
    if (minutesLeft() <= threshold && minutesLeft() > 0 && !state.warned.has(threshold)) {
      state.warned.add(threshold);
      lines.push({
        text: `[!] ${shiftClock()}: ${plural(minutesLeft(), "minute")} left in the shift (${plural(commandsLeft(), "command")}).`,
        kind: "warn",
      });
    }
  }
  return lines;
}

/** 6:00 AM: the session closes and the case file is filed as is. */
function endShift() {
  terminal.print([{ text: "" }, { text: `[!] ${shiftClock()}. The day crew has the server now. Session closed.`, kind: "warn" }]);
  if (state.config.autoSubmitAtShiftEnd !== false) {
    terminal.print([{ text: "[!] Filing your case file as is.", kind: "warn" }]);
    fileCase({ auto: true });
  }
}

/* ---------- Running commands ---------- */

function onCommand(raw) {
  if (state.over) return;
  const promptText = state.shell.prompt();
  const result = state.shell.run(raw);
  terminal.echo(promptText, result.input);
  if (!result.input.trim()) return;

  if (result.clear) terminal.clear();
  const lines = [...result.lines];

  if (result.lines.some((l) => l.kind === "warn")) play("unflag");
  lines.push(...logClues(result));

  if (isCharged(result)) {
    state.commands += 1;
    state.minutes = Math.min(shiftMinutes(), state.minutes + state.config.minutesPerCommand);
    lines.push(...clockWarnings());
  }

  terminal.print(lines);
  terminal.setPrompt(state.shell.prompt());
  terminal.announce(lines.length ? lines : [{ text: "Done. No output." }]);
  updateHud({ bump: lines.some((l) => l.kind === "clue") });
  updateSession();

  if (minutesLeft() === 0) endShift();
}

/* ---------- Side pane tabs (Evidence / Case file) ---------- */

const TABS = ["evidence", "casefile"];

function selectTab(name, { focus = false } = {}) {
  for (const tab of TABS) {
    const on = tab === name;
    const button = $(`tab-${tab}`);
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on;
  }
  if (focus) $(`tab-${name}`).focus();
}

/** Arrow keys, Home, and End move between tabs (the ARIA tabs pattern). */
function onTabKey(event) {
  const index = TABS.findIndex((t) => `tab-${t}` === event.target.id);
  if (index < 0) return;
  let next = null;
  if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
  else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = TABS.length - 1;
  if (next === null) return;
  event.preventDefault();
  selectTab(TABS[next], { focus: true });
}

/* ---------- Filing the case file ---------- */

/** "File case report": check the input, then confirm (listing blank fields). */
function requestFile() {
  if (state.over) return;
  const invalid = caseFile.validateAll();
  const summary = $("cf-summary");
  if (invalid.length) {
    summary.textContent = `Fix ${invalid.length === 1 ? "1 field" : `${invalid.length} fields`} before filing: ${invalid.map((q) => q.label).join(", ")}.`;
    summary.hidden = false;
    caseFile.focusField(invalid[0]);
    return;
  }
  summary.hidden = true;
  const blanks = caseFile.blankQuestions();
  $("n2-submit-blanks").hidden = blanks.length === 0;
  $("n2-submit-blank-list").replaceChildren(...blanks.map((q) => el("li", { text: q.label })));
  $("n2-submit-desc").textContent = `Filing closes your session on kl-rpt-01 at ${shiftClock()}. You can't run more commands or change your answers.`;
  $("n2-submit-dialog").showModal();
}

/**
 * File the case: close the session, grade the answers, and show the report.
 * `auto` is true when the clock ran out at 6:00 AM; invalid input then
 * scores as wrong instead of blocking the filing.
 */
async function fileCase({ auto = false } = {}) {
  if (state.over) return;
  state.over = true;
  const filedAt = shiftClock();
  terminal.lock(auto ? "Session closed at 6:00 AM" : `Case filed at ${filedAt}`);
  caseFile.setDisabled(true);
  $("cf-submit-btn").disabled = true;
  updateSession();

  const responses = caseFile.responses();
  const grades = await gradeCaseFile(state.data.caseFile, responses);
  const answerXp = caseFileXp(grades, state.config.xp);
  const clueXp = state.found.length * state.config.xp.clueFound;
  state.xp = clueXp + answerXp;
  renderReport({ grades, responses, answerXp, clueXp, filedAt, auto });
}

/* ---------- End of shift report ---------- */

function renderReport({ grades, responses, answerXp, clueXp, filedAt, auto }) {
  const { caseFile: questions, clues, debrief, briefing } = state.data;
  const rank = rankFor(state.xp, maxPossibleXp(), state.config.ranks);
  const correct = grades.filter((g) => g.correct).length;

  $("n2-results-report-id").textContent = `${briefing.caseId}-N${NIGHT}`;
  $("n2-results-filed").textContent = auto
    ? `Filed automatically at ${filedAt} · Case ${briefing.caseId}`
    : `Filed by you at ${filedAt} · Case ${briefing.caseId}`;
  $("n2-results-title").textContent =
    correct === questions.length ? "Case solved." : correct >= Math.ceil(questions.length / 2) ? "Case filed." : "Case filed with gaps.";
  $("n2-results-rank").textContent = rank;

  const stats = [
    ["Case file answers right", `${correct} / ${questions.length}`],
    ["Evidence found", `${state.found.length} / ${clues.length}`],
    ["Commands run", String(state.commands)],
    ["Evidence XP", signed(clueXp)],
    ["Case file XP", signed(answerXp)],
    ["Final XP", String(state.xp)],
  ];
  $("n2-results-stats").replaceChildren(...stats.flatMap(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })]));

  const { best, isNewBest } = saveNightResult(NIGHT, { xp: state.xp, rank });
  $("n2-results-best").textContent = isNewBest ? "New personal best. Saved to your file." : `Your best on file: ${best.bestXp} XP, ${best.bestRank}`;

  renderReview(grades, responses);
  renderTimeline(debrief.timeline);
  $("n2-audit-heading").textContent = debrief.audit.title;
  $("n2-audit-text").textContent = debrief.audit.text;
  $("n2-audit-status").textContent = state.auditSeen ? debrief.audit.seen : debrief.audit.unseen;
  $("n2-recs").replaceChildren(...debrief.recommendations.map((text) => el("li", { text })));
  $("n2-next").textContent = debrief.nextNight;

  updateHud();
  play("clockOut");
  showScreen("n2-results");
  $("n2-results-title").setAttribute("tabindex", "-1");
  $("n2-results-title").focus({ preventScroll: true });
}

/** Pass or Fail for every answer, with what the player wrote and where the evidence was. */
function renderReview(grades, responses) {
  const { xp } = state.config;
  const questions = state.data.caseFile;
  const wrong = grades.filter((g) => !g.correct).length;
  $("n2-review-summary").textContent = wrong
    ? `${plural(wrong, "answer")} to follow up on. Each one shows where the evidence was.`
    : "Every answer checks out. Nothing to follow up on.";

  $("n2-review-list").replaceChildren(
    ...questions.map((q, i) => {
      const grade = grades[i];
      const written = describeResponse(q, responses[q.id]);
      let answerLine = `Your answer: ${written}`;
      if (grade.blank) answerLine = "Your answer: left blank";
      else if (grade.error) answerLine = `Your answer: ${written} (not accepted: ${grade.error})`;

      const head = el("div", { className: "review-head" }, [
        grade.correct ? tag("Pass", "ok") : tag("Fail", "fail"),
        el("span", { text: `Question ${i + 1}` }),
        el("span", { text: `${signed(grade.correct ? xp.correctAnswer : xp.wrongAnswer)} XP` }),
      ]);
      const body = el("div", { className: "review-body" }, [
        el("h3", { text: q.label }),
        el("p", { className: "review-prompt", text: q.prompt }),
        el("p", { className: `review-answer ${grade.correct ? "is-pass" : "is-fail"}`, text: answerLine }),
        el("p", { className: "review-label", text: "Where the evidence was" }),
        el("p", { className: "review-evidence mono", text: q.evidence }),
        el("p", { className: "review-why", text: q.explanation }),
      ]);
      return el("li", { className: `review-item${grade.correct ? " is-pass" : ""}` }, [head, body]);
    }),
  );
}

/** The real sequence of events. Steps tied to a clue say whether the player saw that evidence. */
function renderTimeline(timeline) {
  const seen = new Set(state.found.map((f) => f.id));
  $("n2-timeline").replaceChildren(
    ...timeline.map((step) => {
      const meta = [el("span", { className: "timeline-source", text: step.source })];
      if (step.clue) meta.unshift(seen.has(step.clue) ? tag("Seen", "ok") : tag("Not seen", "muted"));
      return el("li", { className: `timeline-step${step.clue && seen.has(step.clue) ? " is-seen" : ""}` }, [
        el("span", { className: "timeline-time mono", text: step.time }),
        el("div", { className: "timeline-body" }, [el("p", { text: step.text }), el("p", { className: "timeline-meta" }, meta)]),
      ]);
    }),
  );
}

/* ---------- Handoff and starting the shift ---------- */

function renderBriefing() {
  const { briefing, title } = state.data;
  const { shiftStartHour, shiftEndHour } = state.config;
  $("n2-briefing-title").textContent = title;
  $("n2-briefing-ticket").textContent = briefing.caseId;
  $("n2-ticket-field").textContent = briefing.caseId;
  $("n2-briefing-from").textContent = briefing.from;
  $("n2-briefing-server").textContent = `${briefing.server} (read-only forensic session)`;
  $("n2-briefing-shift").textContent = `${formatClock(shiftStartHour * 60)} to ${formatClock(shiftEndHour * 60)}`;
  $("n2-briefing-priority").textContent = briefing.priority;
  $("n2-briefing-time").textContent = `${state.config.minutesPerCommand} minutes per command (${shiftMinutes() / state.config.minutesPerCommand} commands until 6:00 AM)`;
  $("n2-briefing-body").replaceChildren(...briefing.paragraphs.map((text) => el("p", { text })));

  const best = getNightBest(NIGHT);
  $("n2-briefing-best").hidden = !best;
  $("n2-briefing-best").textContent = best ? `Your best on file: ${best.bestXp} XP, ${best.bestRank}` : "";
}

/** The "?" dialog: the same handoff, without leaving the terminal. */
function buildHelpDialog() {
  const { briefing } = state.data;
  $("n2-help-title").textContent = `Case ${briefing.caseId}: handoff`;
  $("n2-help-from").textContent = `From ${briefing.from}`;
  $("n2-help-body").replaceChildren(...briefing.paragraphs.map((text) => el("p", { text })));
  const lists = document.querySelectorAll("#screen-n2-briefing .legend, #screen-n2-briefing .legend-title");
  $("n2-help-legend").replaceChildren(...[...lists].map((node) => node.cloneNode(true)));
}

export function openBriefing() {
  renderBriefing();
  state.minutes = 0;
  state.xp = 0;
  state.found = [];
  updateHud();
  showScreen("n2-briefing");
  $("n2-start-btn").focus({ preventScroll: true });
}

function startShift() {
  state.shell = createShell(state.data, { now: () => state.config.shiftStartHour * 60 + state.minutes });
  state.minutes = 0;
  state.xp = 0;
  state.commands = 0;
  state.found = [];
  state.auditSeen = false;
  state.warned = new Set();
  state.over = false;

  terminal.reset();
  caseFile.reset();
  $("cf-submit-btn").disabled = false;
  $("cf-summary").hidden = true;
  selectTab("evidence");
  terminal.print([...state.data.host.loginBanner.map((text) => ({ text })), { text: "" }, { text: "Type help for commands. Your case notes: cat CASE-README.txt", kind: "note" }]);
  terminal.setPrompt(state.shell.prompt());
  renderEvidence();
  updateHud();
  updateSession();
  showScreen("terminal");
  terminal.focus();
}

/* ---------- Hooks for the app shell ---------- */

/** True while the investigation is running (the app asks before logging off). */
export function isShiftInProgress() {
  return isScreenVisible("terminal") && !state.over;
}

export function openHelp() {
  if (!isScreenVisible("terminal")) return;
  $("n2-help-dialog").showModal();
}

export function onProgressReset() {
  $("n2-briefing-best").hidden = true;
  $("n2-briefing-best").textContent = "";
  if (isScreenVisible("n2-results")) $("n2-results-best").textContent = "No saved best score on file.";
}

/* ---------- Setup ---------- */

function validateData(data) {
  const ok =
    data &&
    data.config &&
    data.config.xp &&
    Array.isArray(data.config.ranks) &&
    data.config.ranks.length > 0 &&
    Number.isFinite(data.config.minutesPerCommand) &&
    data.config.minutesPerCommand > 0 &&
    Array.isArray(data.config.freeCommands) &&
    Array.isArray(data.config.clockWarningsMinutesLeft) &&
    data.host &&
    typeof data.host.hostname === "string" &&
    data.fs &&
    typeof data.fs === "object" &&
    Array.isArray(data.clues) &&
    Array.isArray(data.caseFile) &&
    data.caseFile.every((q) => Array.isArray(q.answerHashes)) &&
    data.debrief &&
    Array.isArray(data.debrief.timeline) &&
    Array.isArray(data.debrief.recommendations) &&
    data.debrief.audit &&
    Array.isArray(data.debrief.audit.match);
  if (!ok) throw new Error("Night 2 data is malformed.");
  return data;
}

export function init({ onExit }) {
  exitToMenu = onExit;
  $("n2-start-btn").addEventListener("click", startShift);
  $("n2-briefing-back-btn").addEventListener("click", () => exitToMenu());
  $("n2-results-menu-btn").addEventListener("click", () => exitToMenu());
  $("n2-replay-btn").addEventListener("click", startShift);

  for (const tab of TABS) $(`tab-${tab}`).addEventListener("click", () => selectTab(tab));
  $("tab-evidence").addEventListener("keydown", onTabKey);
  $("tab-casefile").addEventListener("keydown", onTabKey);

  $("cf-submit-btn").addEventListener("click", requestFile);
  $("n2-submit-cancel").addEventListener("click", () => $("n2-submit-dialog").close());
  $("n2-submit-confirm").addEventListener("click", () => {
    $("n2-submit-dialog").close();
    fileCase();
  });
  $("n2-submit-dialog").addEventListener("click", (event) => {
    if (event.target === $("n2-submit-dialog")) $("n2-submit-dialog").close();
  });
  $("n2-help-close").addEventListener("click", () => $("n2-help-dialog").close());
  $("n2-help-dialog").addEventListener("click", (event) => {
    if (event.target === $("n2-help-dialog")) $("n2-help-dialog").close();
  });
  $("n2-help-dialog").addEventListener("close", () => {
    if (isScreenVisible("terminal") && !state.over) terminal.focus();
  });
}

/** Fetch and check Night 2's data. Returns the data; throws if it can't load. */
export async function load() {
  const response = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = validateData(await response.json());
  state.config = state.data.config;

  terminal = createTerminal(
    {
      output: $("term-output"),
      input: $("term-input"),
      prompt: $("term-prompt"),
      live: $("term-live"),
      hint: $("term-hint"),
      keys: $("term-keys"),
    },
    {
      onCommand,
      onComplete: (text) => state.shell.complete(text),
      getHistory: () => state.shell?.history ?? [],
      maxInput: state.config.maxInputLength,
      scrollbackLines: state.config.scrollbackLines,
    },
  );
  caseFile = createCaseFile($("cf-fields"), state.data.caseFile, { onChange: updateTabCounts });
  renderBriefing();
  buildHelpDialog();
  return state.data;
}
