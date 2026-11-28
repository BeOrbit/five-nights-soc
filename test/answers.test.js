import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareResponse,
  gradeResponse,
  gradeCaseFile,
  caseFileXp,
  isBlankResponse,
  sha256Hex,
  normalizePathAnswer,
  normalizeChecklist,
} from "../public/js/answers.js";

test("sha256Hex matches a known vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("normalizing trims, lowercases, drops trailing slashes, and sorts checklists", () => {
  assert.equal(normalizePathAnswer("  /TMP/.Cache-X//  "), "/tmp/.cache-x");
  assert.equal(normalizePathAnswer("/"), "/");
  assert.equal(normalizeChecklist(["tar", "Copy", "tar"]), "copy,tar");
});

test("prepareResponse validates each question type", () => {
  assert.deepEqual(prepareResponse({ type: "text" }, "  "), { blank: true });
  assert.deepEqual(prepareResponse({ type: "text" }, " JPike "), { normalized: "jpike" });
  assert.match(prepareResponse({ type: "text" }, "j pike").error, /letters, numbers/);
  assert.match(prepareResponse({ type: "text" }, "<script>").error, /letters, numbers/);
  assert.match(prepareResponse({ type: "text" }, "a".repeat(40)).error, /under 32/);
  assert.deepEqual(prepareResponse({ type: "ipv4" }, "203.0.113.47"), { normalized: "203.0.113.47" });
  assert.match(prepareResponse({ type: "ipv4" }, "203.0.113.256").error, /IPv4/);
  assert.match(prepareResponse({ type: "ipv4" }, "203.0.113").error, /IPv4/);
  assert.match(prepareResponse({ type: "path" }, "tmp/x").error, /starts with \//);
  assert.match(prepareResponse({ type: "path" }, "/tmp/x;rm").error, /starts with \//);
  const checklist = { type: "checklist", options: [{ id: "a" }, { id: "b" }] };
  assert.deepEqual(prepareResponse(checklist, ["b", "a"]), { normalized: "a,b" });
  assert.match(prepareResponse(checklist, ["z"]).error, /listed options/);
  assert.deepEqual(prepareResponse(checklist, []), { blank: true });
  const mp = { type: "mechanism-path", mechanisms: [{ id: "cron" }] };
  assert.deepEqual(prepareResponse(mp, { mechanism: "cron", path: "/x/" }), { normalized: "cron|/x" });
  assert.deepEqual(prepareResponse(mp, { mechanism: "", path: "" }), { blank: true });
  assert.match(prepareResponse(mp, { mechanism: "cron", path: "" }).error, /full path/);
  assert.match(prepareResponse(mp, { mechanism: "nope", path: "/x" }).error, /Choose/);
});

test("gradeResponse compares the hash of the normalized answer", async () => {
  const question = { type: "text", answerHashes: [await sha256Hex("jpike")] };
  assert.deepEqual(await gradeResponse(question, "JPIKE "), { correct: true, blank: false, error: null });
  assert.deepEqual(await gradeResponse(question, "root"), { correct: false, blank: false, error: null });
  assert.deepEqual(await gradeResponse(question, ""), { correct: false, blank: true, error: null });
  assert.equal((await gradeResponse(question, "j p")).error !== null, true);
});

test("gradeCaseFile grades every question in order; invalid input scores as wrong", async () => {
  const questions = [
    { id: "a", type: "text", answerHashes: [await sha256Hex("jpike")] },
    { id: "b", type: "ipv4", answerHashes: [await sha256Hex("203.0.113.47")] },
    { id: "c", type: "path", answerHashes: [await sha256Hex("/tmp")] },
  ];
  const grades = await gradeCaseFile(questions, { a: "jpike", b: "203.0.113" });
  assert.deepEqual(grades.map((g) => g.id), ["a", "b", "c"]);
  assert.equal(grades[0].correct, true);
  assert.equal(grades[1].correct, false);
  assert.match(grades[1].error, /IPv4/);
  assert.equal(grades[2].blank, true);
  assert.equal(caseFileXp(grades, { correctAnswer: 100, wrongAnswer: -75 }), 100 - 75 - 75);
});

test("isBlankResponse spots empty answers of every type", () => {
  assert.equal(isBlankResponse({ type: "text" }, "  "), true);
  assert.equal(isBlankResponse({ type: "text" }, "x"), false);
  assert.equal(isBlankResponse({ type: "checklist", options: [] }, []), true);
  assert.equal(isBlankResponse({ type: "mechanism-path", mechanisms: [] }, { mechanism: "", path: "" }), true);
  assert.equal(isBlankResponse({ type: "mechanism-path", mechanisms: [] }, { mechanism: "cron", path: "" }), false);
});
