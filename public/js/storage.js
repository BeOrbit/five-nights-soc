/**
 * Saved progress in localStorage.
 *
 * localStorage can throw (private browsing, blocked storage, full quota) and
 * its contents can be edited by anyone, so every read is wrapped in try/catch
 * and checked before use. If anything goes wrong, the game still works; it
 * just won't remember your best score.
 */

const STORAGE_KEY = "fns.progress.v1";

function emptyProgress() {
  return { nights: {} };
}

function isValidResult(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    Number.isFinite(result.bestXp) &&
    typeof result.bestRank === "string" &&
    result.bestRank.length <= 40
  );
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || typeof data.nights !== "object" || data.nights === null) {
      return emptyProgress();
    }
    // Keep only well-formed entries for nights 1 to 5.
    const nights = {};
    for (let n = 1; n <= 5; n++) {
      if (isValidResult(data.nights[n])) nights[n] = data.nights[n];
    }
    return { nights };
  } catch {
    return emptyProgress();
  }
}

function writeProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** Best result for a night, or null if it hasn't been played. */
export function getNightBest(night) {
  return loadProgress().nights[night] ?? null;
}

/**
 * Record a finished night. Returns { best, isNewBest } so the results screen
 * can celebrate a new personal best.
 */
export function saveNightResult(night, { xp, rank }) {
  const progress = loadProgress();
  const previous = progress.nights[night];
  const isNewBest = !previous || xp > previous.bestXp;
  if (isNewBest) {
    progress.nights[night] = { bestXp: xp, bestRank: rank, completedAt: new Date().toISOString() };
    writeProgress(progress);
  }
  return { best: progress.nights[night], isNewBest };
}

/** Delete all saved progress (best XP and rank for every night). */
export function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Settings ---------- */

const SETTINGS_KEY = "fns.settings.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  sound: false,
  reduceMotion: false,
  largeText: false,
});

/** Saved settings, with anything missing or malformed replaced by the default. */
export function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return settings;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return settings;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof data[key] === "boolean") settings[key] = data[key];
    }
  } catch {
    // Fall back to defaults.
  }
  return settings;
}

export function saveSettings(settings) {
  const clean = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) clean[key] = settings[key] === true;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}
