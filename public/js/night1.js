/**
 * Night 1: the phishing inbox.
 *
 * The game is driven entirely by data/night1.json: emails, scoring, ranks,
 * and shift length all come from there. This file turns that data into the
 * inbox and handles hovering, flagging, verdicts, XP, and the clock. The main
 * menu, taskbar, and settings live in app.js and screens.js.
 *
 * Security note: every piece of email content is inserted with textContent,
 * never innerHTML, so nothing in the data can run as code. Links inside
 * emails are plain <span>s, not <a> tags; the player can inspect where a
 * link "goes", but the game never navigates anywhere.
 */

import { getNightBest, saveNightResult } from "./storage.js";
import { scrollBehavior } from "./settings.js";
import { play } from "./sound.js";
import { $, el, tag, formatClock, signed, plural, shiftCode as codeFor } from "./ui.js";
import { rankFor as rankForXp } from "./ranks.js";
import { showScreen, onScreenChange, isScreenVisible } from "./screens.js";

const NIGHT = 1;
const DATA_URL = "data/night1.json";
const WORKSTATION = "SOC-WS-07";

// Called when the player leaves Night 1 for the main menu (set in init()).
let exitToMenu = () => {};

const state = {
  data: null,
  config: null,
  index: 0, // the email waiting for a verdict (the "current" one)
  viewing: 0, // the email on screen; can be an earlier, already-handled one
  xp: 0,
  minutes: 0,
  flagged: new Set(),
  resolved: false,
  results: [],
};

// Tooltip text for each inspectable element, kept out of the DOM.
const tooltips = new WeakMap();

// Pointer tracking, so touch taps can inspect before they flag.
const pointer = { type: "mouse", down: false };
let tipOwner = null;

/* ---------- Small helpers ---------- */

function isRedFlag(email, id) {
  return Object.hasOwn(email.redFlags, id);
}

/** "MMDD" from the night's shift date, used in ticket numbers. */
function shiftCode() {
  return codeFor(state.data.shiftDate);
}

function ticketId(i) {
  return `INC-${shiftCode()}-${String(i + 1).padStart(4, "0")}`;
}

function handoffId() {
  return `HANDOFF SOC-${shiftCode()}-N${NIGHT}`;
}

function shiftClock() {
  return formatClock(state.config.shiftStartHour * 60 + state.minutes);
}

/* ---------- Derived values (all from config) ---------- */

function minutesPerEmail() {
  const { shiftStartHour, shiftEndHour } = state.config;
  return ((shiftEndHour - shiftStartHour) * 60) / state.data.emails.length;
}

function maxPossibleXp() {
  const { xp } = state.config;
  return state.data.emails.reduce(
    (sum, email) => sum + xp.correctCall + xp.redFlagFound * Object.keys(email.redFlags).length,
    0,
  );
}

/** Ranks are set as a percent of the best possible score, so they scale as emails are added. */
function rankFor(xp) {
  return rankForXp(xp, maxPossibleXp(), state.config.ranks);
}

function currentEmail() {
  return state.data.emails[state.index];
}

function handledCount() {
  return state.results.filter(Boolean).length;
}

/** True when the on-screen email can't be flagged or decided. */
function isLocked() {
  return state.resolved || state.viewing !== state.index;
}

/* ---------- HUD ---------- */

function updateProgress() {
  const total = state.data.emails.length;
  const done = handledCount();
  $("hud-progress-text").textContent = `${done} of ${total} emails handled`;
  const bar = $("hud-progress");
  bar.setAttribute("aria-label", "Emails handled");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  $("hud-progress-fill").style.width = `${total ? (done / total) * 100 : 0}%`;
}

function updateFolders() {
  const done = state.results.filter(Boolean);
  const open = state.data.emails.length - done.length;
  $("folder-queue").textContent = String(open);
  $("folder-reported").textContent = String(done.filter((r) => r.choice === "phishing").length);
  $("folder-trusted").textContent = String(done.filter((r) => r.choice === "legitimate").length);
  $("status-queue").textContent = `Queue: ${open} open`;
}

function updateHud({ bump = false } = {}) {
  $("hud-clock").textContent = shiftClock();
  updateProgress();
  updateFolders();
  const xpNode = $("hud-xp");
  xpNode.textContent = String(state.xp);
  $("hud-rank").textContent = rankFor(state.xp);
  if (bump) {
    xpNode.classList.remove("xp-bump");
    void xpNode.offsetWidth; // restart the animation
    xpNode.classList.add("xp-bump");
  }
}

/* ---------- Shift state and the handoff dialog ---------- */

/** True while emails are being worked (the app asks before logging off). */
export function isShiftInProgress() {
  return isScreenVisible("inbox");
}

/** The "?" button: the same briefing, in a dialog, without leaving the shift. */
function buildBriefingDialog() {
  const { briefing } = state.data;
  $("briefing-dialog-title").textContent = `Shift handoff: ${handoffId()}`;
  $("briefing-dialog-from").textContent = `From ${briefing.from}`;
  $("briefing-dialog-body").replaceChildren(...briefing.paragraphs.map((text) => el("p", { text })));
  // Reuse the legend and shortcut lists from the briefing screen so they never drift apart.
  const lists = document.querySelectorAll("#screen-briefing .legend, #screen-briefing .legend-title");
  $("briefing-dialog-legend").replaceChildren(...[...lists].map((node) => node.cloneNode(true)));
}

export function openBriefingDialog() {
  if (!isShiftInProgress()) return;
  hideTooltip();
  $("briefing-dialog").showModal();
}

/** After "Reset progress", stop showing the old best score on Night 1's screens. */
export function onProgressReset() {
  $("briefing-best").hidden = true;
  $("briefing-best").textContent = "";
  if (isScreenVisible("results")) $("results-best").textContent = "No saved best score on file.";
}

function renderBriefing() {
  const { briefing, title } = state.data;
  const { shiftStartHour, shiftEndHour } = state.config;
  $("briefing-title").textContent = title;
  $("briefing-ticket").textContent = handoffId();
  $("briefing-ticket-field").textContent = handoffId().replace("HANDOFF ", "");
  $("briefing-from").textContent = briefing.from;
  $("briefing-shift").textContent = `${formatClock(shiftStartHour * 60)} to ${formatClock(shiftEndHour * 60)}`;
  $("briefing-body").replaceChildren(...briefing.paragraphs.map((text) => el("p", { text })));

  const best = getNightBest(NIGHT);
  $("briefing-best").hidden = !best;
  if (best) $("briefing-best").textContent = `Your best on file: ${best.bestXp} XP, ${best.bestRank}`;

  const start = $("start-btn");
  start.textContent = "Acknowledge and start shift";
  start.disabled = false;
}

export function openBriefing() {
  renderBriefing();
  state.minutes = 0;
  state.xp = 0;
  state.results = [];
  updateHud();
  showScreen("briefing");
  $("start-btn").focus({ preventScroll: true });
}

/* ---------- Inbox list ---------- */

function renderMailList() {
  const list = $("email-list");
  const emails = state.data.emails;
  list.replaceChildren(
    ...emails.map((email, i) => {
      const result = state.results[i];
      let status = "is-queued";
      if (result) status = "is-done";
      else if (i === state.index) status = "is-current";
      if (i === state.viewing) status += " is-viewing";

      const item = el("li", { className: `mail-item ${status}` }, [
        el("span", { className: "mi-ticket", text: ticketId(i) }),
        el("span", { className: "mi-time", text: email.received }),
        el("span", { className: "mi-from", text: email.from.name }),
        el("span", { className: "mi-subject", text: email.subject }),
      ]);
      if (i === state.viewing) item.setAttribute("aria-current", "true");

      // Status is always spelled out in words, never color alone.
      const statusRow = el("span", { className: "mi-status" });
      if (result) {
        const action = result.choice === "phishing" ? "Reported" : "Trusted";
        statusRow.append(tag(result.correct ? "Pass" : "Fail", result.correct ? "ok" : "fail"), tag(action, "muted"));
        if (i === state.viewing) statusRow.append(tag("Viewing", "amber"));
      } else if (i === state.index) {
        statusRow.append(tag("Open", "amber"));
      } else {
        statusRow.append(tag("Queued", "muted"));
      }
      item.append(statusRow);
      return item;
    }),
  );
  const left = emails.length - handledCount();
  $("queue-count").textContent = `(${left} left)`;
}

/* ---------- Email rendering ---------- */

/** An element the player can hover to inspect and click to flag. */
function flaggable(tag, id, className, tooltip) {
  const node = el(tag, {
    className: `flaggable ${className}`.trim(),
    attrs: { tabindex: "0", role: "button", "aria-pressed": "false" },
  });
  node.dataset.flagId = id;
  if (tooltip && state.config.tooltips) tooltips.set(node, tooltip);
  return node;
}

function renderSegment(segment, autoId) {
  // Plain strings are clickable too, so real red flags don't stand out.
  const seg = typeof segment === "string" ? { id: autoId, text: segment } : segment;

  // Keep trailing spaces outside the clickable span so flag marks sit
  // right after the sentence, not against the next one.
  const text = seg.text.trimEnd();
  const trailing = seg.text.slice(text.length);

  const node = seg.href
    ? flaggable("span", seg.id, "fake-link", { label: "Link goes to", value: seg.href })
    : flaggable("span", seg.id, "", null);
  node.textContent = text;

  if (!trailing) return node;
  const fragment = document.createDocumentFragment();
  fragment.append(node, trailing);
  return fragment;
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "FILE" : name.slice(dot + 1).toUpperCase();
}

function renderEmail(email) {
  const view = $("email-view");
  view.classList.remove("is-resolved");
  const parts = [];

  const i = state.data.emails.indexOf(email);
  $("ticket-line").textContent = `${ticketId(i)} · Opened ${email.received} · Source: SOC inbox (user report)`;

  if (email.forwardedBy) {
    const note = el("div", { className: "forward-note" }, [
      el("strong", { text: "Forwarded to SOC by " }),
      document.createTextNode(email.forwardedBy),
    ]);
    if (email.forwardNote) note.append(el("p", { text: `"${email.forwardNote}"` }));
    parts.push(note);
  }

  // Header: the sender shows a display name; the real address is on hover.
  const sender = flaggable("span", "sender", "", { label: "Real sender address", value: email.from.address });
  sender.textContent = email.from.name;

  const meta = el("dl", { className: "email-meta" }, [
    el("dt", { text: "From" }),
    el("dd", {}, [sender]),
  ]);
  if (email.replyTo) {
    const replyTo = flaggable("span", "replyTo", "", { label: "Replies will go to", value: email.replyTo });
    replyTo.textContent = email.replyTo;
    meta.append(el("dt", { text: "Reply-To" }), el("dd", {}, [replyTo]));
  }
  meta.append(
    el("dt", { text: "To" }),
    el("dd", { text: email.to }),
    el("dt", { text: "Received" }),
    el("dd", { text: email.received }),
  );

  parts.push(
    el("header", { className: "email-head" }, [
      el("h2", { className: "email-subject", text: email.subject }),
      meta,
    ]),
  );

  // Body: paragraphs made of segments.
  const body = el("div", { className: "email-body" });
  email.body.forEach((paragraph, pi) => {
    body.append(el("p", {}, paragraph.map((segment, si) => renderSegment(segment, `p${pi}s${si}`))));
  });

  if (email.calendar) {
    const c = email.calendar;
    body.append(
      el("div", { className: "calendar-card" }, [
        tag("Meeting invite", "amber"),
        el("h3", { text: c.title }),
        el("p", { text: c.when }),
        el("p", { text: c.where }),
        el("p", { text: `Organizer: ${c.organizer}` }),
      ]),
    );
  }
  parts.push(body);

  // Attachments: the visible name can hide the real extension.
  if (email.attachments.length > 0) {
    const box = el("div", { className: "attachments" });
    for (const att of email.attachments) {
      const chip = flaggable("span", att.id, "attachment", {
        label: "Full file name",
        value: `${att.fileName}\nType: ${att.fileType}`,
      });
      chip.append(
        el("span", { className: "att-icon", text: fileExtension(att.displayName) }),
        el("span", { text: att.displayName }),
        el("span", { className: "att-size", text: att.size }),
      );
      box.append(chip);
    }
    parts.push(box);
  }

  view.replaceChildren(...parts);
}

/* ---------- Flagging ---------- */

function updateFlagCount() {
  $("flag-count").textContent = `${state.flagged.size} flagged`;
}

function toggleFlag(node) {
  if (isLocked()) return;
  const id = node.dataset.flagId;
  const nowFlagged = !state.flagged.has(id);
  if (nowFlagged) state.flagged.add(id);
  else state.flagged.delete(id);
  node.classList.toggle("is-flagged", nowFlagged);
  node.setAttribute("aria-pressed", String(nowFlagged));
  updateFlagCount();
  play(nowFlagged ? "flag" : "unflag");
}

/* ---------- Tooltip ---------- */

function showTooltip(node, { touch = false } = {}) {
  const tip = tooltips.get(node);
  if (!tip) return;
  const box = $("tooltip");
  box.replaceChildren(el("span", { className: "tt-label", text: tip.label }), document.createTextNode(tip.value));
  if (touch) {
    const flagged = state.flagged.has(node.dataset.flagId);
    box.append(el("span", { className: "tt-hint", text: flagged ? "Tap again to unflag" : "Tap again to flag" }));
  }
  box.hidden = false;
  if (tipOwner && tipOwner !== node) tipOwner.removeAttribute("aria-describedby");
  tipOwner = node;
  // Screen readers announce the tooltip as the focused element's description.
  node.setAttribute("aria-describedby", "tooltip");

  const rect = node.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const margin = 8;
  let left = Math.min(rect.left, window.innerWidth - boxRect.width - margin);
  left = Math.max(margin, left);
  let top = rect.bottom + margin;
  if (top + boxRect.height > window.innerHeight - margin) top = rect.top - boxRect.height - margin;
  box.style.left = `${left}px`;
  box.style.top = `${Math.max(margin, top)}px`;
}

function hideTooltip() {
  $("tooltip").hidden = true;
  tipOwner?.removeAttribute("aria-describedby");
  tipOwner = null;
}

/** Touch: the first tap on an inspectable item shows its details; the next tap flags it. */
function handleTap(node) {
  if (isLocked()) return;
  if (tooltips.has(node) && tipOwner !== node) {
    showTooltip(node, { touch: true });
    return;
  }
  toggleFlag(node);
  if (tooltips.has(node)) showTooltip(node, { touch: true });
}

/* ---------- Verdicts and scoring ---------- */

function decide(choice) {
  if (isLocked()) return;
  state.resolved = true;
  hideTooltip();

  const email = currentEmail();
  const { xp } = state.config;
  const correct = choice === email.verdict;
  const flagIds = Object.keys(email.redFlags);
  const found = flagIds.filter((id) => state.flagged.has(id));
  const falseFlags = [...state.flagged].filter((id) => !isRedFlag(email, id));

  const callXp = correct ? xp.correctCall : xp.wrongCall;
  const flagXp = found.length * xp.redFlagFound;
  const falseXp = falseFlags.length * xp.falseFlag;
  const delta = callXp + flagXp + falseXp;

  const loggedAt = shiftClock();
  state.xp += delta;
  state.minutes += minutesPerEmail();
  const result = {
    loggedAt,
    choice,
    correct,
    flagged: [...state.flagged],
    found,
    falseFlags,
    callXp,
    flagXp,
    falseXp,
    delta,
  };
  state.results[state.index] = result;

  play(correct ? "correct" : "wrong");
  revealFlags(email, state.flagged);
  renderFeedback(email, result, state.index);
  $("actions").hidden = true;
  updateHud({ bump: true });
  renderMailList();
}

function revealFlags(email, flaggedIds) {
  const view = $("email-view");
  view.classList.add("is-resolved");
  for (const node of view.querySelectorAll(".flaggable")) {
    const id = node.dataset.flagId;
    const flagged = flaggedIds.has(id);
    const real = isRedFlag(email, id);
    node.classList.remove("is-flagged");
    node.removeAttribute("tabindex");
    node.removeAttribute("role");
    node.removeAttribute("aria-pressed");
    if (real && flagged) node.classList.add("reveal-found");
    else if (real) node.classList.add("reveal-missed");
    else if (flagged) node.classList.add("reveal-false");
  }
}

function renderFeedback(email, r, i, { focus = true } = {}) {
  const panel = $("feedback");
  const verdictWord = email.verdict === "phishing" ? "phishing" : "legitimate";
  panel.className = `feedback ${r.correct ? "is-correct" : "is-wrong"}`;

  const breakdown = [`${signed(r.callXp)} ${r.correct ? "correct call" : "wrong call"}`];
  if (r.found.length) breakdown.push(`${signed(r.flagXp)} for ${plural(r.found.length, "red flag")}`);
  if (r.falseFlags.length) breakdown.push(`${signed(r.falseXp)} for ${plural(r.falseFlags.length, "false flag")}`);

  const action = r.choice === "phishing" ? "Reported as phishing" : "Marked trusted";
  const head = el("div", { className: "fb-head" }, [
    el("span", { text: `Triage result · ${ticketId(i)}` }),
    el("span", { text: `Logged ${r.loggedAt} by ${WORKSTATION}` }),
  ]);

  const children = [
    el("h2", {}, [
      tag(r.correct ? "Pass" : "Fail", r.correct ? "ok" : "fail"),
      document.createTextNode(r.correct ? `Correct: this is ${verdictWord}.` : `Wrong call: this was ${verdictWord}.`),
    ]),
    el("p", { className: "xp-breakdown", text: `${action} · ${breakdown.join(" · ")} = ${signed(r.delta)} XP` }),
    el("p", { text: email.explanation }),
  ];

  const flagIds = Object.keys(email.redFlags);
  if (flagIds.length) {
    children.push(
      el(
        "ul",
        { className: "flag-review" },
        flagIds.map((id) => {
          const found = r.found.includes(id);
          return el("li", { className: found ? "found" : "missed" }, [
            tag(found ? "Found" : "Missed", found ? "ok" : "amber"),
            el("span", { text: email.redFlags[id] }),
          ]);
        }),
      ),
    );
  }

  if (r.falseFlags.length) {
    children.push(
      el("p", {
        className: "best",
        text: `You flagged ${plural(r.falseFlags.length, "thing")} that ${r.falseFlags.length === 1 ? "wasn't a red flag" : "weren't red flags"} (marked NOT A FLAG above).`,
      }),
    );
  }

  const isPast = i !== state.index;
  const isLast = state.index === state.data.emails.length - 1;
  let label = isLast ? "Clock out" : "Next email";
  if (isPast) label = state.resolved ? "Back to latest email" : "Back to current email";
  const next = el("button", { className: "btn btn-primary", text: label, attrs: { type: "button" } });
  next.addEventListener("click", isPast ? () => viewEmail(state.index) : nextEmail);
  children.push(next);

  panel.replaceChildren(head, el("div", { className: "fb-body" }, children));
  panel.hidden = false;
  if (focus) {
    next.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
  }
}

/* ---------- Flow ---------- */

function loadEmail() {
  state.flagged.clear();
  state.resolved = false;
  state.viewing = state.index;
  $("feedback").hidden = true;
  $("actions").hidden = false;
  updateFlagCount();
  renderEmail(currentEmail());
  renderMailList();
}

/**
 * Show any handled email, or the current one, without changing the game.
 * Earlier emails are read-only: they show the verdict and the flag review.
 */
function viewEmail(i) {
  hideTooltip();
  state.viewing = i;
  const email = state.data.emails[i];
  renderEmail(email);

  const result = state.results[i];
  if (result) {
    revealFlags(email, i === state.index ? state.flagged : new Set(result.flagged));
    renderFeedback(email, result, i, { focus: false });
    $("actions").hidden = true;
  } else {
    // The current, undecided email: restore any flags placed before looking back.
    for (const node of $("email-view").querySelectorAll(".flaggable")) {
      const flagged = state.flagged.has(node.dataset.flagId);
      node.classList.toggle("is-flagged", flagged);
      node.setAttribute("aria-pressed", String(flagged));
    }
    $("feedback").hidden = true;
    $("actions").hidden = false;
  }
  renderMailList();
}

function goPrevious() {
  if (state.viewing === 0) return false;
  viewEmail(state.viewing - 1);
  return true;
}

function goNext() {
  if (state.viewing < state.index) {
    viewEmail(state.viewing + 1);
    return true;
  }
  if (state.resolved) {
    nextEmail();
    return true;
  }
  return false;
}

function nextEmail() {
  state.index += 1;
  if (state.index >= state.data.emails.length) {
    finishShift();
    return;
  }
  loadEmail();
  $("email-view").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}

function startShift() {
  state.index = 0;
  state.viewing = 0;
  state.xp = 0;
  state.minutes = 0;
  state.results = [];
  updateHud();
  showScreen("inbox");
  loadEmail();
}

function finishShift() {
  const rank = rankFor(state.xp);
  const total = state.data.emails.length;
  const correct = state.results.filter((r) => r.correct).length;
  const found = state.results.reduce((s, r) => s + r.found.length, 0);
  const flags = state.data.emails.reduce((s, e) => s + Object.keys(e.redFlags).length, 0);
  const falseFlags = state.results.reduce((s, r) => s + r.falseFlags.length, 0);

  $("results-time").textContent = formatClock(state.config.shiftEndHour * 60);
  $("results-report-id").textContent = `SHIFT-${shiftCode()}-N${NIGHT}`;
  $("results-rank").textContent = rank;
  $("results-title").textContent = correct === total ? "Shift complete. Queue clear." : "Shift complete.";

  const stats = [
    ["Correct calls", `${correct} / ${total}`],
    ["Red flags found", `${found} / ${flags}`],
    ["False flags", String(falseFlags)],
    ["Final XP", String(state.xp)],
  ];
  $("results-stats").replaceChildren(
    ...stats.flatMap(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })]),
  );

  const { best, isNewBest } = saveNightResult(NIGHT, { xp: state.xp, rank });
  $("results-best").textContent = isNewBest
    ? "New personal best. Saved to your file."
    : `Your best on file: ${best.bestXp} XP, ${best.bestRank}`;

  renderReview();
  play("clockOut");
  showScreen("results");
}

/** End-of-shift review: every wrong call, the red flags missed, and why. */
function renderReview() {
  const emails = state.data.emails;
  const wrong = state.results
    .map((result, i) => ({ result, email: emails[i], i }))
    .filter(({ result }) => result && !result.correct);

  const list = $("review-list");
  $("review-summary").textContent = wrong.length
    ? `${plural(wrong.length, "wrong call")} on tonight's log. Read them before your next shift.`
    : "Nothing to follow up on. Every call was right.";

  list.replaceChildren(
    ...wrong.map(({ result, email, i }) => {
      const action = result.choice === "phishing" ? "You reported it" : "You trusted it";
      const actual = email.verdict === "phishing" ? "it was phishing" : "it was legitimate";
      const missed = Object.keys(email.redFlags).filter((id) => !result.found.includes(id));

      const head = el("div", { className: "review-head" }, [
        tag("Fail", "fail"),
        el("span", { text: ticketId(i) }),
        el("span", { text: `Logged ${result.loggedAt}` }),
      ]);
      const children = [
        el("h3", { text: email.subject }),
        el("p", { className: "review-call", text: `${action}, but ${actual}.` }),
      ];
      if (missed.length) {
        children.push(
          el("p", { className: "review-label", text: `Missed red flags (${missed.length})` }),
          el("ul", { className: "review-flags" }, missed.map((id) => el("li", { text: email.redFlags[id] }))),
        );
      } else if (email.verdict === "legitimate") {
        children.push(el("p", { className: "review-label", text: "No red flags: this email was safe to trust." }));
      }
      children.push(el("p", { className: "review-why", text: email.explanation }));
      return el("li", { className: "review-item" }, [head, el("div", { className: "review-body" }, children)]);
    }),
  );
}

/* ---------- Setup ---------- */

function validateData(data) {
  const ok =
    data &&
    data.config &&
    data.config.xp &&
    Array.isArray(data.config.ranks) &&
    data.config.ranks.length > 0 &&
    Array.isArray(data.emails) &&
    data.emails.length > 0 &&
    data.emails.every(
      (e) =>
        typeof e.subject === "string" &&
        e.from &&
        Array.isArray(e.body) &&
        Array.isArray(e.attachments) &&
        e.redFlags &&
        (e.verdict === "phishing" || e.verdict === "legitimate"),
    );
  if (!ok) throw new Error("Night data is malformed.");
  return data;
}

function bindEvents() {
  $("briefing-back-btn").addEventListener("click", () => exitToMenu());
  $("results-menu-btn").addEventListener("click", () => exitToMenu());

  $("start-btn").addEventListener("click", startShift);
  $("replay-btn").addEventListener("click", startShift);
  $("report-btn").addEventListener("click", () => decide("phishing"));
  $("trust-btn").addEventListener("click", () => decide("legitimate"));
  $("briefing-dialog-close").addEventListener("click", () => $("briefing-dialog").close());
  $("briefing-dialog").addEventListener("click", (event) => {
    if (event.target === $("briefing-dialog")) $("briefing-dialog").close();
  });
  onScreenChange(hideTooltip);

  // Remember how the last press happened (mouse, pen, or touch).
  document.addEventListener("pointerdown", (event) => {
    pointer.type = event.pointerType || "mouse";
    pointer.down = true;
    if (!event.target.closest?.(".flaggable")) hideTooltip();
  });
  document.addEventListener("pointerup", () => (pointer.down = false));
  document.addEventListener("pointercancel", () => (pointer.down = false));

  // One set of listeners on the email view handles every flaggable element.
  const view = $("email-view");
  view.addEventListener("click", (event) => {
    const node = event.target.closest(".flaggable");
    if (!node) return;
    if (pointer.type === "touch") handleTap(node);
    else toggleFlag(node);
  });
  view.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const node = event.target.closest(".flaggable");
    if (!node) return;
    event.preventDefault();
    toggleFlag(node);
  });
  // Hover inspects with a mouse or pen; touch taps are handled in the click listener.
  view.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const node = event.target.closest(".flaggable");
    if (node && !isLocked()) showTooltip(node);
  });
  view.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    const node = event.target.closest(".flaggable");
    if (node && !node.contains(event.relatedTarget)) hideTooltip();
  });
  // Keyboard focus inspects too, but focus caused by a tap or click doesn't.
  view.addEventListener("focusin", (event) => {
    if (pointer.down) return;
    const node = event.target.closest(".flaggable");
    if (node && !isLocked()) showTooltip(node);
  });
  // Only close the tooltip if it belongs to the element losing focus,
  // so clicking a new element doesn't hide the tooltip it just opened.
  view.addEventListener("focusout", (event) => {
    if (event.target.closest(".flaggable") === tipOwner) hideTooltip();
  });
  window.addEventListener("scroll", hideTooltip, { passive: true });

  document.addEventListener("keydown", handleShortcut);
}

/** R = report, T = trust, arrow keys = move between emails. */
function handleShortcut(event) {
  if ($("screen-inbox").hidden) return;
  if (document.querySelector("dialog[open]")) return; // dialogs own the keyboard
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;

  let handled = false;
  switch (event.key) {
    case "?":
      openBriefingDialog();
      handled = true;
      break;
    case "r":
    case "R":
      if (!event.repeat && !isLocked()) {
        decide("phishing");
        handled = true;
      }
      break;
    case "t":
    case "T":
      if (!event.repeat && !isLocked()) {
        decide("legitimate");
        handled = true;
      }
      break;
    case "ArrowDown":
    case "ArrowRight":
      handled = goNext();
      break;
    case "ArrowUp":
    case "ArrowLeft":
      handled = goPrevious();
      break;
  }
  if (handled) event.preventDefault();
}

/**
 * Wire up Night 1's screens. `onExit` returns the player to the main menu.
 * Call once at startup, before load().
 */
export function init({ onExit }) {
  exitToMenu = onExit;
  bindEvents();
}

/** Fetch and check Night 1's data. Returns the data; throws if it can't load. */
export async function load() {
  const response = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = validateData(await response.json());
  state.config = state.data.config;
  renderBriefing();
  buildBriefingDialog();
  updateHud();
  return state.data;
}
