import { readFileSync } from "node:fs";

/** Load a night's JSON straight from public/data. */
export function loadNight(n) {
  return JSON.parse(readFileSync(new URL(`../public/data/night${n}.json`, import.meta.url), "utf8"));
}

/** Text of every output line from a shell result. */
export const texts = (result) => result.lines.map((l) => l.text);
