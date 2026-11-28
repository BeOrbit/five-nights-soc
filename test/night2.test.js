/**
 * Night 2 data checks.
 *
 * The plaintext answer key is NOT in the repo. It lives in
 * test/answer-key.local.json, which is gitignored. When that file exists, the
 * key checks below grade every answer against the hashes in
 * public/data/night2.json; when it doesn't (a fresh clone), they're skipped
 * and every other check still runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gradeResponse } from "../public/js/answers.js";
import { createShell, matchClues } from "../public/js/terminal/shell.js";
import { loadNight, texts } from "./helpers.js";

const data = loadNight(2);
const question = (id) => data.caseFile.find((q) => q.id === id);

const KEY_FILE = new URL("./answer-key.local.json", import.meta.url);
const KEY = existsSync(KEY_FILE) ? JSON.parse(readFileSync(KEY_FILE, "utf8")) : null;
const needsKey = KEY ? {} : { skip: "no test/answer-key.local.json (the plaintext key is kept out of git)" };

test("night2.json has no plaintext answers, only hashes", () => {
  for (const q of data.caseFile) {
    assert.ok(Array.isArray(q.answerHashes) && q.answerHashes.length > 0, q.id);
    for (const h of q.answerHashes) assert.match(h, /^[0-9a-f]{64}$/, q.id);
    assert.equal(Object.hasOwn(q, "answer"), false, q.id);
    assert.equal(Object.hasOwn(q, "answers"), false, q.id);
  }
});

test("the answer key covers every case-file question", needsKey, () => {
  assert.deepEqual(Object.keys(KEY.answers).sort(), data.caseFile.map((q) => q.id).sort());
  assert.deepEqual(Object.keys(KEY.wrong).sort(), data.caseFile.map((q) => q.id).sort());
});

test("every answer in the key is graded correct", needsKey, async () => {
  for (const [id, answers] of Object.entries(KEY.answers)) {
    for (const answer of answers) {
      const result = await gradeResponse(question(id), answer);
      assert.equal(result.correct, true, `${id}: ${JSON.stringify(answer)}`);
    }
  }
});

test("decoy answers are graded wrong", needsKey, async () => {
  for (const [id, answers] of Object.entries(KEY.wrong)) {
    for (const answer of answers) {
      const result = await gradeResponse(question(id), answer);
      assert.equal(result.error, null, `${id}: ${JSON.stringify(answer)} should be valid input`);
      assert.equal(result.correct, false, `${id}: ${JSON.stringify(answer)}`);
    }
  }
});

test("config holds the Night 2 difficulty numbers", () => {
  const { config } = data;
  assert.equal(config.xp.wrongAnswer, -75);
  assert.equal(config.xp.correctAnswer, 100);
  assert.equal(config.minutesPerCommand, 5);
  assert.equal(((config.shiftEndHour - config.shiftStartHour) * 60) / config.minutesPerCommand, 72);
});

test("every answer can be found in the evidence on the server", needsKey, () => {
  const sh = createShell(data);
  const [account] = KEY.answers.account;
  const [ip] = KEY.answers.ip;
  assert.ok(texts(sh.run("grep Accepted /var/log/auth.log")).some((t) => t.includes(`for ${account} from ${ip}`)));
  const history = texts(sh.run(`cat /home/${account}/.bash_history`));
  const attacker = history.slice(history.indexOf("exit") + 1);
  for (const needle of KEY.evidence.attackerCommands) assert.ok(attacker.some((t) => t.includes(needle)), needle);
  for (const decoy of KEY.evidence.decoyCommands) assert.ok(!attacker.some((t) => t.includes(decoy)), decoy);
  const [{ path: script }] = KEY.answers.persistence;
  assert.ok(texts(sh.run(`cat /var/spool/cron/crontabs/${account}`)).some((t) => t.includes(script)));
  const staged = KEY.answers.staged[0];
  const slash = staged.lastIndexOf("/");
  assert.ok(texts(sh.run(`ls -a ${staged.slice(0, slash)}`))[0].includes(staged.slice(slash + 1)));
  // Decoy persistence methods leave no trace.
  assert.match(texts(sh.run(`cat /home/${account}/.ssh/authorized_keys`))[0], /No such file/);
  assert.ok(!texts(sh.run("cat /etc/passwd")).some((t) => t.startsWith("backup2")));
});

test("every clue can be triggered", () => {
  const sh = createShell(data);
  const found = new Set();
  for (const cmd of ["grep Accepted /var/log/auth.log", "cat ~jpike/.bash_history", "ls -a /tmp", "cat /var/spool/cron/crontabs/jpike", "cat ~jpike/.local/share/.sysd-update.sh"]) {
    for (const id of matchClues(sh.run(cmd), data.clues)) found.add(id);
  }
  assert.deepEqual([...found].sort(), data.clues.map((c) => c.id).sort());
});

test("max XP is 625: five answers and five key clues", () => {
  const { xp } = data.config;
  assert.equal(data.caseFile.length * xp.correctAnswer + data.clues.length * xp.clueFound, 625);
});

test("the debrief timeline and audit note point at real clues and evidence", () => {
  const clueIds = new Set(data.clues.map((c) => c.id));
  const { timeline, audit, recommendations, nextNight } = data.debrief;
  assert.ok(timeline.length > 0 && recommendations.length > 0 && typeof nextNight === "string");
  for (const step of timeline) {
    assert.ok(step.time && step.text && step.source, JSON.stringify(step));
    if (step.clue) assert.ok(clueIds.has(step.clue), step.clue);
  }
  // Every clue shows up somewhere on the timeline.
  for (const id of clueIds) assert.ok(timeline.some((s) => s.clue === id), id);
  // The audit note is matched like a clue (no XP) when the policy file is read.
  const sh = createShell(data);
  const auditClue = [{ id: "audit", match: audit.match }];
  assert.deepEqual(matchClues(sh.run("cat /etc/profile.d/kestrel-audit.sh"), auditClue), ["audit"]);
  assert.deepEqual(matchClues(sh.run("cat /etc/motd"), auditClue), []);
});

test("all IPs in the data are documentation or private addresses", () => {
  const ips = JSON.stringify(data).match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) ?? [];
  for (const ip of new Set(ips)) {
    assert.ok(/^(203\.0\.113\.|198\.51\.100\.|192\.0\.2\.|10\.|127\.0\.0\.1$|0\.0\.0\.0$)/.test(ip), `real-looking IP: ${ip}`);
  }
});
