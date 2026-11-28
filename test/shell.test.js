import { test } from "node:test";
import assert from "node:assert/strict";
import { createShell, sanitizeInput, tokenize, matchClues } from "../public/js/terminal/shell.js";
import { loadNight, texts } from "./helpers.js";

const data = loadNight(2);
const shell = (minutes = 0) => createShell(data, { now: () => minutes });

test("sanitizeInput strips control, escape, and invisible characters and caps length", () => {
  assert.equal(sanitizeInput("ls\u001b[31m -a\u0007"), "ls[31m -a");
  assert.equal(sanitizeInput("cat‮ txt.exe"), "cat txt.exe");
  assert.equal(sanitizeInput("a​b\r\n"), "ab");
  assert.equal(sanitizeInput("x".repeat(500), 200).length, 200);
});

test("tokenize handles quotes, escapes, pipes, and refuses chaining and redirects", () => {
  assert.deepEqual(tokenize(`grep "Failed password" auth.log`).words.map((w) => w.text), ["grep", "Failed password", "auth.log"]);
  assert.deepEqual(tokenize(`grep 'a b'c`).words.map((w) => w.text), ["grep", "a bc"]);
  assert.equal(tokenize("cat x | grep y").words[2].pipe, true);
  assert.match(tokenize("ls; rm x").error, /one command at a time/);
  assert.match(tokenize("ls && ls").error, /one command at a time/);
  assert.match(tokenize("cat $(whoami)").error, /one command at a time/);
  assert.match(tokenize("echo x > f").error, /Read-only/);
  assert.match(tokenize(`grep "open`).error, /unterminated/);
});

test("basic commands: whoami, pwd, hostname, id, help", () => {
  const sh = shell();
  assert.deepEqual(texts(sh.run("whoami")), ["soc-analyst"]);
  assert.deepEqual(texts(sh.run("pwd")), ["/home/soc-analyst"]);
  assert.deepEqual(texts(sh.run("hostname")), ["kl-rpt-01"]);
  assert.match(texts(sh.run("id"))[0], /uid=1004\(soc-analyst\)/);
  assert.ok(texts(sh.run("help")).some((t) => t.includes("grep")));
  assert.equal(sh.prompt(), "soc-analyst@kl-rpt-01:~$ ");
});

test("ls hides dotfiles unless -a, and -l shows details", () => {
  const sh = shell();
  const plain = texts(sh.run("ls /home/jpike"))[0];
  assert.ok(plain.includes("notes.txt"));
  assert.ok(!plain.includes(".bash_history"));
  const all = texts(sh.run("ls -a /home/jpike"))[0];
  assert.ok(all.startsWith(".  .."));
  assert.ok(all.includes(".bash_history") && all.includes(".local"));
  const long = texts(sh.run("ls -la /tmp"));
  assert.match(long[0], /^total \d+$/);
  assert.ok(long.some((t) => /^drwxr-xr-x 2 jpike\s+jpike\s+4096 Nov 27 03:45 \.cache-x$/.test(t)));
  assert.ok(!texts(sh.run("ls /tmp"))[0].includes(".cache-x"));
});

test("ls marks folders and executables, and reports missing paths", () => {
  const sh = shell();
  const [line] = sh.run("ls -a /home/jpike/.local/share").lines;
  assert.deepEqual(line.parts.find((p) => p.text === ".sysd-update.sh").kind, "exec");
  const [dirLine] = sh.run("ls /home").lines;
  assert.ok(dirLine.parts.every((p) => p.kind === "dir" || p.kind === "sep"));
  const missing = sh.run("ls /nope").lines[0];
  assert.equal(missing.kind, "error");
  assert.match(missing.text, /No such file or directory/);
  assert.match(texts(sh.run("ls -z"))[0], /invalid option -- 'z'/);
});

test("cd supports relative, absolute, .., ~, ~user, and -", () => {
  const sh = shell();
  sh.run("cd /var/log");
  assert.equal(sh.cwd, "/var/log");
  sh.run("cd ../spool/cron/crontabs");
  assert.equal(sh.cwd, "/var/spool/cron/crontabs");
  sh.run("cd ~jpike/.local");
  assert.equal(sh.cwd, "/home/jpike/.local");
  assert.equal(sh.prompt(), "soc-analyst@kl-rpt-01:/home/jpike/.local$ ");
  assert.deepEqual(texts(sh.run("cd -")), ["/var/spool/cron/crontabs"]);
  sh.run("cd");
  assert.equal(sh.cwd, "/home/soc-analyst");
  assert.match(texts(sh.run("cd CASE-README.txt"))[0], /Not a directory/);
  assert.match(texts(sh.run("cd /nowhere"))[0], /No such file or directory/);
  assert.match(texts(sh.run("cd /root"))[0], /Permission denied/);
  assert.match(texts(sh.run("cd a b"))[0], /too many arguments/);
});

test("cat prints files and handles folders, binaries, and denied files", () => {
  const sh = shell();
  const readme = sh.run("cat CASE-README.txt");
  assert.ok(texts(readme)[0].startsWith("CASE KL-IR-2026-0047"));
  assert.ok(readme.lines.every((l) => l.shows[0] === "/home/soc-analyst/CASE-README.txt"));
  assert.match(texts(sh.run("cat /tmp"))[0], /Is a directory/);
  assert.match(texts(sh.run("cat /etc/shadow"))[0], /Permission denied/);
  const bin = sh.run("cat /tmp/.cache-x/sys-update.tgz").lines[0];
  assert.equal(bin.kind, "note");
  assert.match(bin.text, /binary file \(gzip compressed data, 412,883 bytes\)/);
  assert.match(texts(sh.run("cat"))[0], /missing file operand/);
});

test("auth.log has the generated noise in time order", () => {
  const sh = shell();
  const lines = texts(sh.run("cat /var/log/auth.log"));
  assert.ok(lines.length > 400, `expected a long log, got ${lines.length}`);
  const failed = lines.filter((t) => t.includes("from 198.51.100.23"));
  assert.equal(failed.length, data.config.noise.bruteForceAttempts);
  const stamps = lines.map((t) => t.slice(0, 15));
  assert.deepEqual(stamps, [...stamps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), "auth.log should be sorted by time");
});

test("grep: plain match, -i, -n, -c, -v, multiple files, and -r", () => {
  const sh = shell();
  const accepted = texts(sh.run("grep Accepted /var/log/auth.log"));
  assert.ok(accepted.some((t) => t.includes("Accepted password for jpike from 203.0.113.47 port 51122")));
  assert.ok(accepted.every((t) => t.includes("Accepted")));
  assert.deepEqual(texts(sh.run("grep -c 'Failed password for jpike' /var/log/auth.log")), ["1"]);
  assert.ok(texts(sh.run("grep -i ACCEPTED /var/log/auth.log")).length === accepted.length);
  assert.match(texts(sh.run("grep -n tar /home/jpike/.bash_history"))[0], /^16:tar czf/);
  const notHash = texts(sh.run("grep -v '#' /var/spool/cron/crontabs/jpike"));
  assert.deepEqual(notHash, ["*/15 * * * * /home/jpike/.local/share/.sysd-update.sh >/dev/null 2>&1"]);
  const multi = texts(sh.run("grep -h 203.0.113.47 /var/log/auth.log /home/jpike/.local/share/.sysd-update.sh"));
  assert.ok(multi.every((t) => !t.startsWith("/")));
  const recursive = texts(sh.run("grep -r 203.0.113.47 /home/jpike"));
  assert.ok(recursive.some((t) => t.startsWith("/home/jpike/.bash_history:")));
  assert.ok(recursive.some((t) => t.startsWith("/home/jpike/.local/share/.sysd-update.sh:")));
  assert.match(texts(sh.run("grep x /var/log"))[0], /Is a directory/);
  assert.match(texts(sh.run("grep -P x f"))[0], /invalid option/);
  assert.match(texts(sh.run("grep"))[0], /Usage/);
});

test("pipes feed text into grep, and only grep reads a pipe", () => {
  const sh = shell();
  const cron = texts(sh.run("cat /var/log/syslog | grep jpike | grep CMD"));
  assert.ok(cron.length >= 80, `expected about 81 cron runs, got ${cron.length}`);
  assert.ok(cron.every((t) => t.includes("(jpike) CMD")));
  assert.match(texts(sh.run("ls | cat"))[0], /only grep, head, and tail can/);
  assert.match(texts(sh.run("ls |"))[0], /syntax error/);
  // Errors from the first stage still show, and don't get filtered.
  const piped = sh.run("cat /nope | grep x");
  assert.equal(piped.lines[0].kind, "error");
});

test("globs expand in the last part of a path", () => {
  const sh = shell();
  const csvs = texts(sh.run("ls /srv/dispatch/exports/*.csv"))[0];
  assert.ok(csvs.includes("/srv/dispatch/exports/driver_roster.csv"));
  const logs = texts(sh.run("grep -c Accepted /var/log/auth*"));
  assert.equal(logs.length, 2);
  assert.ok(logs[0].startsWith("/var/log/auth.log:"));
});

test("history is the player's own session; last and ps read the simulated tables", () => {
  const sh = shell(65);
  sh.run("whoami");
  sh.run("pwd");
  assert.deepEqual(texts(sh.run("history")), ["    1  whoami", "    2  pwd", "    3  history"]);
  assert.deepEqual(texts(sh.run("history 1")), ["    4  history 1"]);
  const last = texts(sh.run("last jpike"));
  assert.ok(last.some((t) => t.includes("203.0.113.47") && t.includes("03:14 - 03:41")));
  assert.ok(last.every((t) => t === "" || t.startsWith("jpike") || t.startsWith("wtmp")));
  const own = texts(sh.run("ps"));
  assert.equal(own.length, 3);
  const all = texts(sh.run("ps aux"));
  assert.ok(all.some((t) => t.startsWith("jpike") && t.includes(".sysd-update.sh")));
  assert.ok(all.at(-1).includes(" 01:05 ") && all.at(-1).endsWith("ps aux"));
  assert.deepEqual(texts(sh.run("date")), ["Sat Nov 28 01:05:00 EST 2026"]);
});

test("write, network, sudo, unknown, and exit commands are handled safely", () => {
  const sh = shell();
  for (const cmd of ["rm -rf /tmp/.cache-x", "crontab -r", "kill 3431", "nano notes.txt", "tar czf x.tgz /home"]) {
    const r = sh.run(cmd);
    assert.equal(r.lines[0].kind, "warn", cmd);
    assert.match(r.lines[0].text, /Read-only forensic session/, cmd);
    assert.equal(r.known, true);
  }
  assert.match(texts(sh.run("curl http://203.0.113.47:8443/s"))[0], /Network tools are disabled/);
  assert.match(texts(sh.run("sudo cat /etc/shadow"))[0], /not in the sudoers file/);
  const unknown = sh.run("rf -x");
  assert.deepEqual(texts(unknown), ["bash: rf: command not found"]);
  assert.equal(unknown.known, false);
  assert.equal(sh.run("exit").known, false);
  assert.equal(sh.run("   ").known, false);
  assert.equal(sh.run("clear").clear, true);
});

test("Tab completion: commands, paths, hidden files, and multiple matches", () => {
  const sh = shell();
  assert.deepEqual(sh.complete("wh"), { input: "whoami ", options: [] });
  assert.deepEqual(sh.complete("h"), { input: "h", options: ["head", "help", "history", "hostname"] });
  assert.equal(sh.complete("cat CASE").input, "cat CASE-README.txt ");
  assert.equal(sh.complete("cd /var/sp").input, "cd /var/spool/");
  assert.equal(sh.complete("ls ~jpike/.lo").input, "ls ~jpike/.local/");
  // Hidden names only complete when the prefix starts with a dot.
  assert.deepEqual(sh.complete("ls /tmp/").options, []);
  assert.equal(sh.complete("ls /tmp/").input, "ls /tmp/rptd.lock ");
  assert.deepEqual(sh.complete("ls /tmp/.").options, [".cache-x/", ".ICE-unix/", ".X11-unix/"]);
  assert.equal(sh.complete("cat /var/log/a").input, "cat /var/log/auth.log");
  assert.deepEqual(sh.complete("cat /var/log/auth.log").options, ["auth.log", "auth.log.1"]);
  assert.equal(sh.complete("cat /var/log/syslog | gr").input, "cat /var/log/syslog | grep ");
});

test("matchClues detects each clue from realistic commands", () => {
  const sh = shell();
  const clues = data.clues;
  const found = (cmd) => matchClues(sh.run(cmd), clues);
  assert.deepEqual(found("grep Accepted /var/log/auth.log"), ["login"]);
  assert.deepEqual(found("ls /tmp"), []);
  assert.deepEqual(found("ls -a /tmp"), ["staging"]);
  assert.deepEqual(found("ls -la /tmp | grep cache"), ["staging"]);
  assert.deepEqual(found("ls /tmp/.cache-x"), ["staging"]);
  assert.deepEqual(found("cat ~jpike/.bash_history"), ["history"]);
  assert.deepEqual(found("cat /var/spool/cron/crontabs/jpike"), ["cron"]);
  assert.deepEqual(found("grep jpike /var/log/syslog"), ["cron"]);
  assert.deepEqual(found("cat /home/jpike/.local/share/.sysd-update.sh"), ["script"]);
  assert.deepEqual(found("cat /home/jpike/.local/share/.sysd-update.sh | grep curl"), ["script"]);
  // Reading the history shows the crontab command, but that isn't finding the cron job itself.
  assert.ok(!found("cat /home/jpike/.bash_history").includes("cron"));
  assert.deepEqual(found("grep -c Accepted /var/log/auth.log"), []);
});

/* ---------- Playtest fixes ---------- */

/** What the screen draws for a line: its parts joined, or its text. */
const rendered = (line) => (line.parts ? line.parts.map((p) => p.text).join("") : line.text);

test("ls separates names with two spaces on screen, not just in the text", () => {
  const sh = shell();
  const [line] = sh.run("ls -a /home").lines;
  assert.equal(rendered(line), ".  ..  jpike  mreyes  soc-analyst");
  assert.equal(rendered(line), line.text);
  assert.equal(line.columns, true, "plain ls rows can be stacked on narrow screens");
  for (const cmd of ["ls /home", "ls -a /home/jpike", "ls /srv/dispatch/exports"]) {
    for (const l of sh.run(cmd).lines) assert.equal(rendered(l), l.text, cmd);
  }
  assert.ok(!/[a-z](jpike|svc-backup)/.test(rendered(sh.run("ls /var/spool/cron/crontabs").lines[0])));
});

test("ls -1 and ls into a pipe print one name per line", () => {
  const sh = shell();
  assert.deepEqual(texts(sh.run("ls -1 /home")), ["jpike", "mreyes", "soc-analyst"]);
  assert.deepEqual(texts(sh.run("ls /var/spool/cron/crontabs | grep svc")), ["svc-backup"]);
  assert.deepEqual(texts(sh.run("ls -a /tmp | head -n 2")), [".", ".."]);
});

test("usage errors are free like typos; real lookups still cost time", () => {
  const sh = shell();
  for (const cmd of ["cat", "grep", "grep Failed", "ls -z", "cat -n x", "grep -P x f", "head", "tail -n", "tail -n abc /var/log/syslog", "head -q x", "ps -Z", "history x", "cd a b", "last -x", "ls | cat"]) {
    const r = sh.run(cmd);
    assert.equal(r.known, false, `${cmd} should be free`);
    assert.equal(r.lines[0].kind, "error", cmd);
  }
  for (const cmd of ["cat /nope", "ls /nope", "grep x /var/log/syslog", "head /var/log/auth.log", "cat /etc/shadow"]) {
    assert.equal(sh.run(cmd).known, true, `${cmd} should cost time`);
  }
});

test("head and tail trim files and pipes, with -n N, -nN, -N, and tail -n +N", () => {
  const sh = shell();
  const auth = texts(sh.run("cat /var/log/auth.log"));
  assert.deepEqual(texts(sh.run("head /var/log/auth.log")), auth.slice(0, 10));
  assert.deepEqual(texts(sh.run("tail /var/log/auth.log")), auth.slice(-10));
  assert.deepEqual(texts(sh.run("head -n 3 /var/log/auth.log")), auth.slice(0, 3));
  assert.deepEqual(texts(sh.run("head -n3 /var/log/auth.log")), auth.slice(0, 3));
  assert.deepEqual(texts(sh.run("tail -5 /var/log/auth.log")), auth.slice(-5));
  assert.deepEqual(texts(sh.run("tail -n 0 /var/log/auth.log")), []);
  const readme = texts(sh.run("cat ~/CASE-README.txt"));
  assert.deepEqual(texts(sh.run("tail -n +3 ~/CASE-README.txt")), readme.slice(2));
  assert.deepEqual(texts(sh.run("head -n 999 ~/CASE-README.txt")), readme);
  // Pipes in and out.
  const accepted = texts(sh.run("grep Accepted /var/log/auth.log"));
  assert.deepEqual(texts(sh.run("grep Accepted /var/log/auth.log | tail -n 2")), accepted.slice(-2));
  assert.deepEqual(texts(sh.run("cat /var/log/auth.log | head -n 50 | grep Failed")), auth.slice(0, 50).filter((t) => t.includes("Failed")));
  // Several files get headers, and errors are reported per file.
  const multi = texts(sh.run("head -n 1 /etc/motd /var/spool/cron/crontabs/jpike"));
  assert.equal(multi[0], "==> /etc/motd <==");
  assert.ok(multi.includes("==> /var/spool/cron/crontabs/jpike <=="));
  assert.match(texts(sh.run("tail /tmp"))[0], /tail: \/tmp: Is a directory/);
  assert.match(texts(sh.run("head /etc/shadow"))[0], /Permission denied/);
  assert.equal(sh.run("tail /tmp/.cache-x/sys-update.tgz").lines[0].kind, "note");
  assert.ok(texts(sh.run("help")).some((t) => t.trim().startsWith("head")));
});

test("each clue can be found at least two different ways", () => {
  const ways = {
    login: [
      "grep Accepted /var/log/auth.log",
      "grep 203.0.113.47 /var/log/auth.log",
      "cat /var/log/auth.log | grep jpike",
      "grep -r Accepted /var/log",
      "grep -n 'for jpike' /var/log/auth.log",
    ],
    history: [
      "cat ~jpike/.bash_history",
      "tail -n 15 /home/jpike/.bash_history",
      "grep curl /home/jpike/.bash_history",
      "grep -r 203.0.113.47 /home/jpike",
      "cat /home/jpike/.bash_history | grep tar",
    ],
    staging: ["ls -a /tmp", "ls -A /tmp", "ls -la /tmp", "ls /tmp/.cache-x", "ls -a /tmp | grep cache", "cat /tmp/.cache-x/sys-update.tgz", "ls /tmp/.c*"],
    cron: [
      "cat /var/spool/cron/crontabs/jpike",
      "tail -n 1 /var/spool/cron/crontabs/jpike",
      "grep -r sysd /var/spool/cron",
      "grep jpike /var/log/syslog",
      "cat /var/log/syslog | grep CMD | tail -n 3",
      "tail /var/log/syslog",
    ],
    script: [
      "cat /home/jpike/.local/share/.sysd-update.sh",
      "head ~jpike/.local/share/.sysd-update.sh",
      "grep curl /home/jpike/.local/share/.sysd-update.sh",
      "grep -r 8443/k /home/jpike",
      "cat /home/jpike/.local/share/.sysd-update.sh | grep keepalive",
    ],
  };
  assert.deepEqual(Object.keys(ways).sort(), data.clues.map((c) => c.id).sort());
  for (const [id, cmds] of Object.entries(ways)) {
    assert.ok(cmds.length >= 2);
    for (const cmd of cmds) {
      assert.ok(matchClues(shell().run(cmd), data.clues).includes(id), `${cmd} should reveal ${id}`);
    }
  }
});

test("clues only count when the evidence itself is on screen", () => {
  const sh = shell();
  const found = (cmd) => matchClues(sh.run(cmd), data.clues);
  // Typing the clue text into a command only echoes it back in an error.
  assert.deepEqual(found(`cat "Accepted password for jpike from 203.0.113.47"`), []);
  assert.deepEqual(found(`grep "tar czf sys-update.tgz" /nope`), []);
  // The player's own history shows what they typed, not server evidence.
  sh.run(`grep "(jpike) CMD (/home/jpike/.local/share/.sysd-update.sh" /etc/motd`);
  assert.deepEqual(found("history"), []);
  // Filtered away, counted, or not hidden: nothing was shown.
  assert.deepEqual(found("cat /home/jpike/.local/share/.sysd-update.sh | grep nothing-here"), []);
  assert.deepEqual(found("grep -c Accepted /var/log/auth.log"), []);
  assert.deepEqual(found("ls /tmp"), []);
  assert.deepEqual(found("head -n 3 /var/log/auth.log"), []);
  // The history mentions the folder and the crontab line, but that's the history clue only.
  assert.deepEqual(found("cat /home/jpike/.bash_history"), ["history"]);
});

test("CASE-README says the forensic account can read root-only folders like /var/spool/cron", () => {
  const readme = texts(shell().run("cat ~/CASE-README.txt")).join(" ");
  assert.match(readme, /\/var\/spool\/cron/);
  assert.match(readme, /root-only/);
});
