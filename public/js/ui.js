/**
 * Small DOM and formatting helpers shared by every night.
 *
 * Security note: el() only ever sets text through textContent, never
 * innerHTML, so game data can't inject markup or script.
 */

export const $ = (id) => document.getElementById(id);

/** Build an element. Text always goes through textContent. */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

/** A small status tag. The word carries the meaning; color only reinforces it. */
export function tag(text, kind) {
  return el("span", { className: `tag tag-${kind}`, text });
}

/** Minutes after midnight to "1:05 AM". */
export function formatClock(totalMinutes) {
  const minutes = Math.round(totalMinutes);
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "MMDD" from a "YYYY-MM-DD" shift date, used in ticket numbers. */
export function shiftCode(shiftDate) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(shiftDate ?? "");
  return match ? `${match[1]}${match[2]}` : "0000";
}
