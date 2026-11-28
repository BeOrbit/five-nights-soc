/**
 * Print the SHA-256 hash of an already-normalized case-file answer, for
 * pasting into a night's "answerHashes". Uses the same code as the game.
 *
 *   node scripts/hash-answer.js "jpike"
 *   node scripts/hash-answer.js "cron|/home/jpike/.local/share/.sysd-update.sh"
 *
 * See public/js/answers.js for the normalizing rules (trim, lowercase,
 * no trailing slash on paths, sorted ids for checklists, "|" between parts).
 */

import { sha256Hex } from "../public/js/answers.js";

const answers = process.argv.slice(2);
if (!answers.length) {
  console.error('Usage: node scripts/hash-answer.js "<normalized answer>" [...]');
  process.exit(1);
}
for (const answer of answers) console.log(`${await sha256Hex(answer)}  ${answer}`);
