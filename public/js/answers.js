/**
 * Case-file answers: validate, normalize, and check against SHA-256 hashes.
 *
 * The night data never stores plaintext answers, only hashes of the
 * normalized answer, checked here with the Web Crypto API. This keeps an
 * answer key out of plain sight in night2.json. It is NOT anti-cheat: short
 * answers like an account name or an IP can be brute-forced from a hash, and
 * the evidence itself contains the answers. Real scoring moves to the Worker
 * when the leaderboard is added.
 *
 * Normalizing (must match scripts/hash-answer.js and the tests):
 *   - every text part: trimmed and lowercased
 *   - paths: trailing slashes dropped ("/tmp/x/" becomes "/tmp/x")
 *   - checklists: the chosen option ids, sorted, joined with ","
 *   - multi-part answers (mechanism + path): parts joined with "|"
 *
 * Question types: "text", "ipv4", "path", "checklist", "mechanism-path".
 */

const LIMITS = { text: 32, ipv4: 15, path: 200 };
const TEXT_PATTERN = /^[a-z0-9._-]+$/;
const PATH_PATTERN = /^\/[a-z0-9._\/-]*$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePathAnswer(value) {
  const text = normalizeText(value);
  return text.length > 1 ? text.replace(/\/+$/, "") || "/" : text;
}

export function normalizeChecklist(ids) {
  return [...new Set(ids.map(normalizeText))].sort().join(",");
}

/** Check one free-text field. Returns an error message, or null if it's fine. */
function checkField(kind, value, maxLength) {
  if (value.length > maxLength) return `Keep it under ${maxLength} characters.`;
  if (kind === "text" && !TEXT_PATTERN.test(value)) return "Use letters, numbers, dots, dashes, or underscores only.";
  if (kind === "ipv4" && !IPV4_PATTERN.test(value)) return "Enter an IPv4 address, like 10.0.0.1.";
  if (kind === "path" && !PATH_PATTERN.test(value)) return "Enter a full path that starts with /, like /var/log/syslog.";
  return null;
}

/**
 * Validate and normalize a player's response to one question.
 *   text / ipv4 / path:  response is a string
 *   checklist:           response is an array of option ids
 *   mechanism-path:      response is { mechanism, path }
 * Returns { blank: true } for an empty answer (it scores as wrong),
 * { error } for invalid input, or { normalized } ready to hash.
 */
export function prepareResponse(question, response) {
  const max = question.maxLength ?? LIMITS[question.type] ?? LIMITS.path;
  switch (question.type) {
    case "text":
    case "ipv4": {
      const value = normalizeText(response);
      if (!value) return { blank: true };
      const error = checkField(question.type, value, max);
      return error ? { error } : { normalized: value };
    }
    case "path": {
      const value = normalizePathAnswer(response);
      if (!value) return { blank: true };
      const error = checkField("path", value, max);
      return error ? { error } : { normalized: value };
    }
    case "checklist": {
      const ids = Array.isArray(response) ? response : [];
      if (!ids.length) return { blank: true };
      const valid = new Set(question.options.map((o) => o.id));
      if (!ids.every((id) => valid.has(id))) return { error: "Pick from the listed options." };
      return { normalized: normalizeChecklist(ids) };
    }
    case "mechanism-path": {
      const mechanism = normalizeText(response?.mechanism);
      const path = normalizePathAnswer(response?.path);
      if (!mechanism && !path) return { blank: true };
      if (!question.mechanisms.some((m) => m.id === mechanism)) return { error: "Choose how the attacker gets back in." };
      if (!path) return { error: "Enter the full path of the file it runs." };
      const error = checkField("path", path, max);
      return error ? { error } : { normalized: `${mechanism}|${path}` };
    }
    default:
      throw new Error(`Unknown question type: ${question.type}`);
  }
}

/** SHA-256 of a string, as lowercase hex. Works in browsers and in Node. */
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Grade one response. Returns { correct, blank, error }.
 * An invalid response isn't graded; the case file should show the error instead.
 */
export async function gradeResponse(question, response) {
  const prepared = prepareResponse(question, response);
  if (prepared.error) return { correct: false, blank: false, error: prepared.error };
  if (prepared.blank) return { correct: false, blank: true, error: null };
  const hash = await sha256Hex(prepared.normalized);
  return { correct: question.answerHashes.includes(hash), blank: false, error: null };
}

/**
 * Grade a whole case file. `responses` maps question id to the player's
 * response (shapes as in prepareResponse). Returns one grade per question,
 * in case-file order: { id, correct, blank, error }.
 * Invalid input (for example, when the case file auto-submits at 6 AM with
 * a half-typed IP) scores as wrong, the same as a blank.
 */
export async function gradeCaseFile(questions, responses) {
  return Promise.all(questions.map(async (q) => ({ id: q.id, ...(await gradeResponse(q, responses[q.id])) })));
}

/** XP from case-file grades: right answers earn, wrong, blank, and invalid ones cost. */
export function caseFileXp(grades, { correctAnswer, wrongAnswer }) {
  return grades.reduce((sum, g) => sum + (g.correct ? correctAnswer : wrongAnswer), 0);
}

/** True when a response has nothing filled in (used to warn before filing). */
export function isBlankResponse(question, response) {
  return prepareResponse(question, response).blank === true;
}
