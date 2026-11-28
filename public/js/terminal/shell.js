/**
 * Night 2's simulated shell: a small, read-only command interpreter.
 *
 * Security note: nothing here executes anything. Commands are looked up in a
 * fixed table and act on the fake file system from filesystem.js. There is no
 * eval, no network, and no access to the real machine. Input is length-capped
 * and stripped of control characters before it's parsed or echoed, so it
 * can't smuggle terminal escape codes or invisible text into the output.
 *
 * Pure logic, no DOM: the terminal screen (chunk 2) renders the results, and
 * `node --test` exercises everything here directly.
 *
 * Every command returns a result:
 *   lines:  [{ text, kind?, parts?, shows?, columns? }]
 *           kind is "error", "warn", or "note" (anything else is normal output)
 *           parts (ls only) are [{ text, kind? }] where kind is "dir", "exec", or "sep"
 *           shows lists the server paths whose names or contents that line puts on
 *           screen, so clue tracking can judge what the player actually saw, no
 *           matter which command (or pipe) printed it
 *           columns marks an ls row of names that a narrow screen can stack
 *   known:  false for empty input, unknown commands, syntax errors, and usage
 *           errors such as a missing file name (the clock skips these)
 *   clear:  true when the screen should be cleared
 */

import { buildFileSystem, compareNames, joinPath, normalizePath, splitPath } from "./filesystem.js";

const DEFAULT_MAX_INPUT = 200;

/** Commands the shell understands, for help and Tab completion. */
export const COMMANDS = ["cat", "cd", "clear", "date", "grep", "head", "help", "history", "hostname", "id", "last", "ls", "ps", "pwd", "tail", "whoami"];

/** Commands that can read another command's output through a pipe. */
const PIPE_READERS = new Set(["grep", "head", "tail"]);

/** Commands that would change the server. They're refused: kl-rpt-01 is evidence. */
const WRITE_COMMANDS = new Set([
  "rm", "rmdir", "cp", "mv", "touch", "mkdir", "chmod", "chown", "chgrp", "ln", "tee", "truncate", "shred", "dd",
  "crontab", "kill", "pkill", "killall", "nano", "vi", "vim", "emacs", "ed", "sed", "useradd", "userdel", "usermod",
  "passwd", "systemctl", "service", "reboot", "shutdown", "apt", "apt-get", "tar", "zip", "unzip", "gzip",
]);

/** Network tools. Refused: the forensic session can't reach anything outside the server. */
const NETWORK_COMMANDS = new Set(["curl", "wget", "scp", "sftp", "ssh", "nc", "ncat", "ping", "ftp", "telnet", "rsync"]);

const HELP = [
  "Commands in this read-only forensic session:",
  "",
  "  help                       show this list",
  "  whoami, id, hostname       who and where you are",
  "  pwd                        print the current folder",
  "  ls [-a] [-l] [path]        list files (-a shows hidden files, -l shows details)",
  "  cd [path]                  change folder (.., ~, ~user, and - work)",
  "  cat <file>...              print files",
  "  grep [-i -n -c -v -r] <text> <file>...",
  "                             show lines containing <text> (plain text, not regex)",
  "  head [-n N] <file>...      first N lines (10 if you don't say)",
  "  tail [-n N] <file>...      last N lines (tail -n +N starts at line N)",
  "  history                    commands you've typed this session",
  "  last [user]                recent logins",
  "  ps [aux]                   running processes (aux shows every user's)",
  "  date                       current server time",
  "  clear                      clear the screen",
  "",
  "Pipe into grep, head, or tail with |, for example:",
  "  cat /var/log/syslog | grep CRON | tail -n 5",
  "Tab completes commands and paths. Up and down arrows recall commands.",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- Input ---------- */

/**
 * Remove control characters (including ESC, so no terminal escape codes),
 * zero-width and bidirectional-override characters, then cap the length.
 */
export function sanitizeInput(raw, maxLength = DEFAULT_MAX_INPUT) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, "")
    .slice(0, maxLength);
}

/**
 * Split a command line into words. Handles 'single' and "double" quotes and
 * backslash escapes. Returns { words, error } where each word is
 * { text, quoted } and a bare | becomes { pipe: true }.
 */
export function tokenize(input) {
  const words = [];
  let current = null;
  let quote = null;
  const push = () => {
    if (current) words.push(current);
    current = null;
  };
  const start = () => (current ??= { text: "", quoted: false });

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length && /["\\$`]/.test(input[i + 1])) current.text += input[++i];
      else current.text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      start().quoted = true;
      quote = ch;
    } else if (ch === "\\") {
      if (i + 1 < input.length) start().text += input[++i];
    } else if (/\s/.test(ch)) {
      push();
    } else if (ch === "|") {
      if (input[i + 1] === "|") return { error: "This session runs one command at a time (no ||)." };
      push();
      words.push({ pipe: true });
    } else if (ch === ";" || ch === "&" || ch === ">" || ch === "<" || ch === "`" || (ch === "$" && input[i + 1] === "(")) {
      if (ch === ">") return { error: "Read-only forensic session: kl-rpt-01 is evidence. Nothing was changed." };
      return { error: `This session runs one command at a time (no ${ch === "$" ? "$(" : ch}).` };
    } else {
      start().text += ch;
    }
  }
  if (quote) return { error: "bash: syntax error: unterminated quoted string" };
  push();
  return { words };
}

/* ---------- Helpers ---------- */

const out = (text, kind) => (kind ? { text, kind } : { text });
const err = (text) => out(text, "error");
/** A line of server content: text plus the path(s) it reveals. */
const shown = (text, shows, kind) => ({ ...out(text, kind), shows });
/**
 * A usage mistake (missing file name, bad option). Like a typo, it doesn't
 * cost clock time: the player hasn't actually looked at anything yet.
 */
const usage = (...lines) => ({ lines, usage: true });

function parseFlags(args, allowed, command) {
  const flags = new Set();
  const rest = [];
  let done = false;
  for (const arg of args) {
    if (!done && !arg.quoted && arg.text === "--") {
      done = true;
    } else if (!done && !arg.quoted && arg.text.startsWith("-") && arg.text.length > 1) {
      for (const letter of arg.text.slice(1)) {
        if (!allowed.includes(letter)) {
          return { error: usage(err(`${command}: invalid option -- '${letter}'`), out("Type help to see what this session supports.", "note")) };
        }
        flags.add(letter);
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* ---------- The shell ---------- */

/**
 * Create a shell for one shift.
 *   data:      the night's JSON (needs host, fs, last, ps, config)
 *   options.now(): minutes since midnight on the shift date (the game clock)
 */
export function createShell(data, { now = () => 0 } = {}) {
  const { host } = data;
  const config = data.config ?? {};
  const maxInput = config.maxInputLength ?? DEFAULT_MAX_INPUT;
  const fs = buildFileSystem(data.fs, config);
  const homes = host.homes ?? {};
  const home = homes[host.user] ?? "/";

  let cwd = home;
  let previousDir = home;
  let nextPid = host.firstPid ?? 10000;
  const history = [];

  /* ----- paths ----- */

  /** Resolve what the player typed to an absolute path, or null for an unknown ~user. */
  function resolve(text) {
    let path = text;
    if (path === "~" || path.startsWith("~/")) {
      path = home + path.slice(1);
    } else if (path.startsWith("~")) {
      const m = /^~([^/]+)(.*)$/.exec(path);
      if (!Object.hasOwn(homes, m[1])) return null;
      path = homes[m[1]] + m[2];
    }
    if (!path.startsWith("/")) path = `${cwd}/${path}`;
    return normalizePath(path);
  }

  const lookup = (text) => {
    const path = resolve(text);
    return path ? fs.nodes.get(path) ?? null : null;
  };

  /** The current folder as the prompt shows it, with the home folder as ~. */
  function displayDir(path = cwd) {
    if (path === home) return "~";
    if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
    return path;
  }

  function prompt() {
    return `${host.user}@${host.hostname}:${displayDir()}$ `;
  }

  /** Expand * and ? in the last part of an unquoted word. No match leaves the word as typed, like bash. */
  function expandGlobs(args) {
    const result = [];
    for (const arg of args) {
      if (arg.quoted || !/[*?]/.test(arg.text)) {
        result.push(arg);
        continue;
      }
      const slash = arg.text.lastIndexOf("/");
      const dirText = slash === -1 ? "" : arg.text.slice(0, slash + 1);
      const pattern = arg.text.slice(slash + 1);
      const dirNode = lookup(dirText || ".");
      if (/[*?]/.test(dirText) || !dirNode || dirNode.type !== "dir" || dirNode.denied) {
        result.push(arg);
        continue;
      }
      const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
      const matches = fs.children
        .get(dirNode.path)
        .filter((name) => (pattern.startsWith(".") || !name.startsWith(".")) && regex.test(name));
      if (matches.length === 0) result.push(arg);
      else for (const name of matches) result.push({ text: dirText + name, quoted: true });
    }
    return result;
  }

  /* ----- clock ----- */

  function clockParts() {
    const minutes = Math.max(0, Math.floor(now()));
    const base = new Date(`${data.shiftDate}T00:00:00Z`);
    const date = new Date(base.getTime() + minutes * 60000);
    return { date, hhmm: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}` };
  }

  /* ----- commands ----- */

  function cmdHelp() {
    return { lines: HELP.map((t) => out(t)) };
  }

  function cmdLs(args, stdin, { piped = false } = {}) {
    const parsed = parseFlags(args, "alA1", "ls");
    if (parsed.error) return parsed.error;
    const showAll = parsed.flags.has("a");
    const showHidden = showAll || parsed.flags.has("A");
    const long = parsed.flags.has("l");
    // Like real ls: one name per line with -1 or when the output goes into a pipe.
    const onePerLine = parsed.flags.has("1") || piped;
    const targets = parsed.rest.length ? parsed.rest.map((a) => a.text) : ["."];

    const lines = [];
    const files = [];
    const dirs = [];
    for (const target of targets) {
      const node = lookup(target);
      if (!node) lines.push(err(`ls: cannot access '${target}': No such file or directory`));
      else if (node.type === "dir" && node.denied) lines.push(err(`ls: cannot open directory '${target}': Permission denied`));
      else if (node.type === "dir") dirs.push({ target, node });
      else files.push({ name: target, node });
    }

    const kindOf = (node) => (node.type === "dir" ? "dir" : node.executable ? "exec" : undefined);
    const render = (entries) => {
      if (!entries.length) return [];
      if (!long && onePerLine) {
        return entries.map(({ name, node }) => ({ text: name, parts: [{ text: name, kind: kindOf(node) }], shows: [node.path] }));
      }
      if (!long) {
        // Two spaces between names, as separate parts so the screen can wrap or stack them.
        const parts = [];
        entries.forEach(({ name, node }, i) => {
          if (i > 0) parts.push({ text: "  ", kind: "sep" });
          parts.push({ text: name, kind: kindOf(node) });
        });
        return [{ text: entries.map((e) => e.name).join("  "), parts, shows: entries.map((e) => e.node.path), columns: true }];
      }
      const w = { owner: 0, group: 0, size: 0 };
      for (const { node } of entries) {
        w.owner = Math.max(w.owner, node.owner.length);
        w.group = Math.max(w.group, node.group.length);
        w.size = Math.max(w.size, String(node.size).length);
      }
      return entries.map(({ name, node }) => {
        const prefix = `${node.mode} ${node.type === "dir" ? 2 : 1} ${node.owner.padEnd(w.owner)} ${node.group.padEnd(w.group)} ${String(node.size).padStart(w.size)} ${node.mtime} `;
        return { text: prefix + name, parts: [{ text: prefix }, { text: name, kind: kindOf(node) }], shows: [node.path] };
      });
    };

    lines.push(...render(files));
    dirs.forEach(({ target, node }, i) => {
      if (files.length || i > 0) lines.push(out(""));
      if (targets.length > 1) lines.push(out(`${target}:`));
      const names = fs.children.get(node.path).filter((name) => showHidden || !name.startsWith("."));
      const entries = names.map((name) => ({ name, node: fs.nodes.get(joinPath(node.path, name)) }));
      if (showAll) {
        const parent = fs.nodes.get(splitPath(node.path).dir) ?? node;
        entries.unshift({ name: ".", node }, { name: "..", node: parent });
      }
      if (long) {
        const blocks = entries.reduce((sum, e) => sum + Math.ceil(e.node.size / 4096) * 4, 0);
        lines.push(out(`total ${blocks}`));
      }
      lines.push(...render(entries));
    });
    return { lines };
  }

  function cmdCd(args) {
    if (args.length > 1) return usage(err("bash: cd: too many arguments"));
    const target = args.length ? args[0].text : "~";
    if (target === "-") {
      [cwd, previousDir] = [previousDir, cwd];
      return { lines: [out(cwd)] };
    }
    const node = lookup(target);
    if (!node) return { lines: [err(`bash: cd: ${target}: No such file or directory`)] };
    if (node.type !== "dir") return { lines: [err(`bash: cd: ${target}: Not a directory`)] };
    if (node.denied) return { lines: [err(`bash: cd: ${target}: Permission denied`)] };
    previousDir = cwd;
    cwd = node.path;
    return { lines: [] };
  }

  function cmdCat(args) {
    const parsed = parseFlags(args, "", "cat");
    if (parsed.error) return parsed.error;
    if (!parsed.rest.length) return usage(err("cat: missing file operand"), out("Try: cat <file>", "note"));
    const lines = [];
    for (const { text: target } of parsed.rest) {
      const file = openFile("cat", target);
      if (file.lines) lines.push(...file.lines);
      else lines.push(file.error);
    }
    return { lines };
  }

  /**
   * Open a file for cat, head, or tail. Returns { lines } (the whole file as
   * output lines; a binary file is one note) or { error } (one error line).
   */
  function openFile(command, target) {
    const node = lookup(target);
    if (!node) return { error: err(`${command}: ${target}: No such file or directory`) };
    if (node.type === "dir") return { error: err(`${command}: ${target}: Is a directory`) };
    if (node.denied) return { error: err(`${command}: ${target}: Permission denied`) };
    const shows = [node.path];
    if (node.binary) {
      return { lines: [shown(`[${target}: binary file (${node.binary}, ${node.size.toLocaleString("en-US")} bytes), not printed]`, shows, "note")], binary: true };
    }
    return { lines: node.lines.map((line) => shown(line, shows)) };
  }

  /**
   * head and tail: -n N, -nN, and -N set the line count (default 10);
   * tail -n +N starts at line N. Read files, or a pipe when no file is given.
   */
  function cmdHeadTail(command, args, stdin) {
    let count = 10;
    let fromStart = false; // tail -n +N
    const targets = [];
    const badCount = (text) => usage(err(`${command}: invalid number of lines: '${text}'`), out(`Try: ${command} -n 20 <file>`, "note"));
    for (let i = 0; i < args.length; i++) {
      const { text, quoted } = args[i];
      if (quoted || !text.startsWith("-") || text === "-") {
        targets.push(text);
        continue;
      }
      let value = null;
      if (text === "-n") {
        if (i + 1 >= args.length) return usage(err(`${command}: option requires an argument -- 'n'`), out(`Try: ${command} -n 20 <file>`, "note"));
        value = args[++i].text;
      } else if (text.startsWith("-n")) {
        value = text.slice(2);
      } else if (/^-\d+$/.test(text)) {
        value = text.slice(1);
      } else {
        return usage(err(`${command}: invalid option -- '${text.slice(1, 2)}'`), out(`This session supports: ${command} -n N <file>`, "note"));
      }
      const plus = command === "tail" && value.startsWith("+");
      const digits = plus ? value.slice(1) : value;
      if (!/^\d+$/.test(digits)) return badCount(value);
      count = Number(digits);
      fromStart = plus;
    }
    const pick = (lines) => {
      if (command === "head") return lines.slice(0, count);
      if (fromStart) return lines.slice(Math.max(count, 1) - 1);
      return count === 0 ? [] : lines.slice(-count);
    };

    if (!targets.length) {
      if (stdin) return { lines: pick(stdin) };
      return usage(err(`${command}: missing file operand`), out(`Try: ${command} -n 20 <file>`, "note"));
    }
    const lines = [];
    targets.forEach((target, i) => {
      const file = openFile(command, target);
      if (file.error) {
        lines.push(file.error);
        return;
      }
      if (targets.length > 1) {
        if (i > 0) lines.push(out(""));
        lines.push(out(`==> ${target} <==`));
      }
      lines.push(...(file.binary ? file.lines : pick(file.lines)));
    });
    return { lines };
  }

  /** Every readable text file under a folder, depth first, in ls order. */
  function walk(dirPath) {
    const files = [];
    for (const name of fs.children.get(dirPath)) {
      const node = fs.nodes.get(joinPath(dirPath, name));
      if (node.type === "dir" && node.denied) files.push(node);
      else if (node.type === "dir") files.push(...walk(node.path));
      else files.push(node);
    }
    return files;
  }

  function cmdGrep(args, stdin) {
    const parsed = parseFlags(args, "incvrRhFE", "grep");
    if (parsed.error) {
      return usage(parsed.error.lines[0], out("This session matches plain text only. Options: -i -n -c -v -r", "note"));
    }
    const { flags, rest } = parsed;
    if (!rest.length) return usage(err("Usage: grep [-i] [-n] [-c] [-v] [-r] TEXT [FILE]..."), out("Example: grep Failed /var/log/auth.log", "note"));
    const pattern = rest[0].text;
    const needle = flags.has("i") ? pattern.toLowerCase() : pattern;
    const recursive = flags.has("r") || flags.has("R");
    const lines = [];

    // Each source is { label, node } for a file, or { label, stdin } for a pipe.
    // label prefixes the lines when several files are searched.
    const sources = [];
    let targets = rest.slice(1).map((a) => a.text);
    if (!targets.length && stdin) {
      sources.push({ label: "(standard input)", stdin });
    } else {
      if (!targets.length) {
        if (!recursive) return usage(err("grep: no file given."), out(`Try: grep ${pattern} <file>`, "note"));
        targets = ["."];
      }
      for (const target of targets) {
        const node = lookup(target);
        if (!node) {
          lines.push(err(`grep: ${target}: No such file or directory`));
        } else if (node.type === "dir" && node.denied) {
          lines.push(err(`grep: ${target}: Permission denied`));
        } else if (node.type === "dir") {
          if (!recursive) {
            lines.push(err(`grep: ${target}: Is a directory`));
            continue;
          }
          const base = target === "." ? "" : `${target.replace(/\/+$/, "")}/`;
          for (const file of walk(node.path)) {
            const relative = file.path.slice(node.path === "/" ? 1 : node.path.length + 1);
            sources.push({ label: base + relative, node: file });
          }
        } else {
          sources.push({ label: target, node });
        }
      }
    }

    const showNames = !flags.has("h") && (sources.length > 1 || recursive) && !sources[0]?.stdin;
    for (const source of sources) {
      const node = source.node;
      if (node?.denied) {
        lines.push(err(`grep: ${source.label}: Permission denied`));
        continue;
      }
      if (node?.binary) continue; // binary files aren't searched in this session
      // Piped lines keep the paths they came from, so evidence still counts after a pipe.
      const input = node ? node.lines.map((text) => ({ text, shows: [node.path] })) : source.stdin;
      let count = 0;
      const prefix = showNames ? `${source.label}:` : "";
      input.forEach((line, i) => {
        const hay = flags.has("i") ? line.text.toLowerCase() : line.text;
        if (hay.includes(needle) === flags.has("v")) return;
        count += 1;
        if (!flags.has("c")) lines.push(shown(`${prefix}${flags.has("n") ? `${i + 1}:` : ""}${line.text}`, line.shows));
      });
      if (flags.has("c")) lines.push(out(`${prefix}${count}`));
    }
    return { lines };
  }

  function cmdHistory(args) {
    if (args[0]?.text === "-c") {
      history.length = 0;
      return { lines: [out("Your own session history is cleared. (Clearing history on a real server is a red flag; here it only affects you.)", "note")] };
    }
    let entries = history.map((cmd, i) => ({ cmd, n: i + 1 }));
    if (args.length) {
      const n = Number(args[0].text);
      if (!Number.isInteger(n) || n < 0) return usage(err(`bash: history: ${args[0].text}: numeric argument required`));
      entries = n === 0 ? [] : entries.slice(-n);
    }
    return { lines: entries.map(({ cmd, n }) => out(`${String(n).padStart(5)}  ${cmd}`)) };
  }

  function cmdLast(args) {
    const parsed = parseFlags(args, "", "last");
    if (parsed.error) return parsed.error;
    const users = parsed.rest.map((a) => a.text);
    const rows = data.last.entries.filter((e) => !users.length || users.includes(e.user));
    return { lines: [...rows.map((e) => out(e.text)), out(""), out(data.last.footer)] };
  }

  function cmdPs(args) {
    const pid = nextPid++;
    const { hhmm } = clockParts();
    if (!args.length) {
      return {
        lines: [
          out("    PID TTY          TIME CMD"),
          out(`${String(data.ps.shellPid).padStart(7)} pts/0    00:00:00 bash`),
          out(`${String(pid).padStart(7)} pts/0    00:00:00 ps`),
        ],
      };
    }
    if (args.length > 1 || !/^-?[aeAfuxwl]+$/.test(args[0].text)) {
      return usage(err(`error: unsupported option ${args[0].text}`), out("Try: ps aux", "note"));
    }
    const self = `soc-ana+ ${String(pid).padStart(7)}  0.0  0.0 ${hhmm.padStart(5)}    0:00 ps ${args[0].text}`;
    return { lines: [out(data.ps.header), ...data.ps.rows.map((r) => out(r)), out(self)] };
  }

  function cmdDate() {
    const { date } = clockParts();
    const t = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
    const day = String(date.getUTCDate()).padStart(2, " ");
    return { lines: [out(`${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${day} ${t} ${host.timezone ?? "UTC"} ${date.getUTCFullYear()}`)] };
  }

  const TABLE = {
    help: cmdHelp,
    ls: cmdLs,
    cd: cmdCd,
    pwd: () => ({ lines: [out(cwd)] }),
    cat: cmdCat,
    grep: cmdGrep,
    head: (args, stdin) => cmdHeadTail("head", args, stdin),
    tail: (args, stdin) => cmdHeadTail("tail", args, stdin),
    history: cmdHistory,
    last: cmdLast,
    ps: cmdPs,
    whoami: () => ({ lines: [out(host.user)] }),
    id: () => ({ lines: [out(host.id)] }),
    hostname: () => ({ lines: [out(host.hostname)] }),
    date: cmdDate,
    clear: () => ({ lines: [], clear: true }),
  };

  /**
   * Run one pipeline stage. stdin is the previous stage's output lines (or
   * null); piped is true when this stage's output feeds another command.
   * Returns a result plus known: false for unknown commands and usage errors.
   */
  function runStage(name, args, stdin, piped) {
    if (Object.hasOwn(TABLE, name)) {
      if (stdin && !PIPE_READERS.has(name)) {
        return { lines: [err(`${name}: can't read from a pipe in this session (only grep, head, and tail can)`)], known: false };
      }
      const result = TABLE[name](args, stdin, { piped });
      return { ...result, known: result.usage !== true };
    }
    if (name === "sudo" || name === "su") {
      return {
        known: true,
        lines: [err(`${host.user} is not in the sudoers file. This incident will be reported.`), out("(The forensic account is read-only on purpose.)", "note")],
      };
    }
    if (NETWORK_COMMANDS.has(name)) {
      return { known: true, lines: [out("Network tools are disabled in this forensic session. Don't contact the attacker's systems.", "warn")] };
    }
    if (WRITE_COMMANDS.has(name)) {
      return { known: true, lines: [out("Read-only forensic session: kl-rpt-01 is evidence. Nothing was changed.", "warn")] };
    }
    if (name === "exit" || name === "logout") {
      return { known: false, lines: [out("Your shift isn't over. Use Log off on the taskbar to leave.", "note")] };
    }
    return { known: false, lines: [err(`bash: ${name}: command not found`)] };
  }

  /**
   * Run a full command line. Returns the result plus `input`, the sanitized
   * text that was actually run (what the screen should echo).
   */
  function run(raw) {
    const input = sanitizeInput(raw, maxInput);
    const base = { input, lines: [], events: [], known: false, clear: false };
    if (!input.trim()) return base;
    history.push(input.trim());

    const { words, error } = tokenize(input);
    if (error) return { ...base, lines: [err(error)] };

    // Split into pipeline stages on |.
    const stages = [[]];
    for (const word of words) {
      if (word.pipe) stages.push([]);
      else stages.at(-1).push(word);
    }
    if (stages.some((s) => s.length === 0)) return { ...base, lines: [err("bash: syntax error near unexpected token `|'")] };

    let stdin = null;
    const passthrough = []; // errors and notes go straight to the screen, like stderr
    let last = null;
    let known = true;
    for (const [i, stage] of stages.entries()) {
      const [nameWord, ...rest] = stage;
      const isLast = i === stages.length - 1;
      const result = runStage(nameWord.text, expandGlobs(rest), stdin, !isLast);
      known &&= result.known;
      if (isLast) {
        last = result;
      } else {
        passthrough.push(...result.lines.filter((l) => l.kind));
        stdin = result.lines.filter((l) => !l.kind).map(({ text, shows }) => ({ text, shows }));
      }
    }
    return {
      ...base,
      lines: [...passthrough, ...(last.lines ?? [])],
      known,
      clear: last.clear === true,
    };
  }

  /* ----- Tab completion ----- */

  /**
   * Complete the last word of `input`. Returns { input, options }: the new
   * input text, and the candidates to list when there's more than one.
   */
  function complete(rawInput) {
    const input = sanitizeInput(rawInput, maxInput);
    const start = input.search(/\S*$/);
    const word = input.slice(start);
    const before = input.slice(0, start);
    const isCommand = !/\S/.test(before.split("|").at(-1));

    if (isCommand && !word.includes("/")) {
      const matches = COMMANDS.filter((c) => c.startsWith(word));
      return finish(before, "", word, matches.map((m) => ({ name: m, dir: false })));
    }

    const slash = word.lastIndexOf("/");
    const dirText = slash === -1 ? "" : word.slice(0, slash + 1);
    const prefix = word.slice(slash + 1);
    const dirNode = lookup(dirText || ".");
    if (!dirNode || dirNode.type !== "dir" || dirNode.denied) return { input, options: [] };
    const matches = fs.children
      .get(dirNode.path)
      .filter((name) => name.startsWith(prefix) && (prefix.startsWith(".") || !name.startsWith(".")))
      .map((name) => ({ name, dir: fs.nodes.get(joinPath(dirNode.path, name)).type === "dir" }));
    return finish(before, dirText, prefix, matches);
  }

  function finish(before, dirText, prefix, matches) {
    if (matches.length === 0) return { input: before + dirText + prefix, options: [] };
    if (matches.length === 1) {
      const m = matches[0];
      return { input: before + dirText + m.name + (m.dir ? "/" : " "), options: [] };
    }
    let common = matches[0].name;
    for (const m of matches) while (!m.name.startsWith(common)) common = common.slice(0, -1);
    const options = matches.map((m) => m.name + (m.dir ? "/" : "")).sort(compareNames);
    return { input: before + dirText + (common.length > prefix.length ? common : prefix), options };
  }

  return {
    run,
    complete,
    prompt,
    get cwd() {
      return cwd;
    },
    /** The player's commands this session, oldest first (for up and down arrows). */
    get history() {
      return [...history];
    },
  };
}

/* ---------- Clues ---------- */

/**
 * Which clues a command result put on screen. Detection looks only at the
 * output, never at which command ran, so cat, grep, head, tail, ls, and pipes
 * all count the same. Each clue has `match`, a list of conditions (any one is
 * enough):
 *   { output: "text", from: "/path" }  a line of that file's content containing
 *                                      the text was printed (from is optional;
 *                                      without it, any file's content counts)
 *   { shows: "/path" }                 that path, or anything inside it, was
 *                                      listed or printed
 * Error, warning, and note lines never match output text, so typing a clue
 * into a command (cat "Accepted password...") and getting an error back
 * doesn't count. Only file content and listings carry `shows`, so the
 * player's own `history` can't trigger a clue either.
 */
export function matchClues(result, clues) {
  const content = result.lines.filter((l) => l.shows?.length);
  const inside = (path, root) => path === root || path.startsWith(`${root}/`);
  const found = [];
  for (const clue of clues) {
    const hit = clue.match.some((m) => {
      if (m.output) {
        return content.some((l) => !l.kind && l.text.includes(m.output) && (!m.from || l.shows.includes(m.from)));
      }
      if (m.shows) return content.some((l) => l.shows.some((p) => inside(p, m.shows)));
      return false;
    });
    if (hit) found.push(clue.id);
  }
  return found;
}
