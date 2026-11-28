/**
 * Night 2's fake file system, built from the night's JSON data.
 *
 * Pure data, no DOM: the same code runs in the browser and in `node --test`.
 * Nothing here touches a real disk; "files" are arrays of strings.
 *
 * Data format (`data.fs`): an object keyed by absolute path. Each entry:
 *   { "type": "dir" }                                   a folder
 *   { "lines": ["..."] }                                a text file
 *   { "binary": "gzip compressed data", "size": 123 }   a file cat won't print
 *   { "denied": true }                                  exists, but reading it fails
 * plus optional "owner", "group", "mode", "mtime" ("Nov 27 03:41"), and "size".
 * Text files may also have "generate": [spec, ...] to add repeated log lines
 * (see expandSpec) and "sortByTime": true to merge them in timestamp order.
 * Missing parent folders are created automatically.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MTIME = "Nov 20 06:02";

/* ---------- Paths ---------- */

/** Split an absolute path into its folder and name. */
export function splitPath(path) {
  const i = path.lastIndexOf("/");
  return { dir: i <= 0 ? "/" : path.slice(0, i), name: path.slice(i + 1) };
}

export function joinPath(dir, name) {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/** Collapse ".", "..", and repeated slashes in an absolute path. */
export function normalizePath(path) {
  const parts = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

/* ---------- Generated log lines ---------- */

/** Small seeded random number generator, so generated logs are identical every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "2026-11-27T03:14:22" (treated as UTC so the time zone never matters) to a Date. */
function parseIso(iso) {
  const date = new Date(`${iso}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Bad timestamp: ${iso}`);
  return date;
}

/** Date to a syslog stamp: "Nov 27 03:14:22" (day padded with a space, as syslog does). */
export function syslogStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, " ")} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** Sortable number from a line that starts with a syslog stamp, or null. */
export function stampKey(line) {
  const m = /^([A-Z][a-z]{2}) ([ \d]\d) (\d\d):(\d\d):(\d\d)/.exec(line);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  return ((((month * 32 + Number(m[2])) * 24 + Number(m[3])) * 60 + Number(m[4])) * 60) + Number(m[5]);
}

/**
 * Expand one generator spec into log lines.
 *   template:     string or array of strings (an array gives several lines per event)
 *   start:        ISO time of the first event
 *   count | end:  how many events, or repeat until this ISO time
 *   countKey:     read the count from config.noise[countKey] instead
 *   everySeconds: a number, or [min, max] for a random gap
 *   values:       { name: [choices] } picked at random for {name}
 *   pidStart:     first process id; {pid} goes up for each event
 *   seed:         random seed (defaults to 1)
 * Placeholders: {stamp}, {pid}, {port}, and any key in values.
 */
export function expandSpec(spec, config = {}) {
  const random = mulberry32(spec.seed ?? 1);
  const templates = Array.isArray(spec.template) ? spec.template : [spec.template];
  let count = spec.count;
  if (spec.countKey !== undefined) count = config.noise?.[spec.countKey];
  const end = spec.end ? parseIso(spec.end).getTime() : Infinity;
  if (!Number.isFinite(count) && end === Infinity) throw new Error("Generator needs count, countKey, or end");
  const limit = Number.isFinite(count) ? count : 10000;

  const gap = () => {
    const every = spec.everySeconds ?? 60;
    if (Array.isArray(every)) return every[0] + Math.floor(random() * (every[1] - every[0] + 1));
    return every;
  };

  const lines = [];
  let time = parseIso(spec.start).getTime();
  let pid = spec.pidStart ?? 1000;
  for (let i = 0; i < limit && time <= end; i++) {
    const fields = { stamp: syslogStamp(new Date(time)), pid: String(pid), port: String(32768 + Math.floor(random() * 28000)) };
    for (const [key, choices] of Object.entries(spec.values ?? {})) {
      fields[key] = choices[Math.floor(random() * choices.length)];
    }
    for (const template of templates) {
      lines.push(template.replace(/\{(\w+)\}/g, (match, key) => fields[key] ?? match));
    }
    pid += 1 + Math.floor(random() * 3);
    time += gap() * 1000;
  }
  return lines;
}

/** Fixed lines plus generated ones, merged by timestamp when asked. */
function fileLines(entry, config) {
  const lines = [...(entry.lines ?? [])];
  for (const spec of entry.generate ?? []) lines.push(...expandSpec(spec, config));
  if (!entry.sortByTime) return lines;
  // Stable sort by stamp; lines without a stamp keep their place relative to each other.
  return lines
    .map((text, i) => ({ text, i, key: stampKey(text) ?? -1 }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((l) => l.text);
}

/* ---------- Building the tree ---------- */

function textSize(lines) {
  let size = 0;
  const encoder = new TextEncoder();
  for (const line of lines) size += encoder.encode(line).length + 1;
  return size;
}

/**
 * Build the file system. Returns { nodes, children } where nodes maps each
 * absolute path to a node and children maps each folder to its sorted names.
 */
export function buildFileSystem(fsData, config = {}) {
  const nodes = new Map();

  const addDir = (path, entry = {}) => {
    nodes.set(path, {
      path,
      name: splitPath(path).name || "/",
      type: "dir",
      owner: entry.owner ?? "root",
      group: entry.group ?? entry.owner ?? "root",
      mode: entry.mode ?? "drwxr-xr-x",
      mtime: entry.mtime ?? DEFAULT_MTIME,
      denied: entry.denied === true,
      size: 4096,
    });
  };

  const ensureParents = (path) => {
    const { dir } = splitPath(path);
    if (dir === path || nodes.has(dir)) return;
    ensureParents(dir);
    addDir(dir);
  };

  addDir("/");
  // Folders first, so their owner and mode win over auto-created defaults.
  const entries = Object.entries(fsData).sort(([a], [b]) => a.split("/").length - b.split("/").length);
  for (const [rawPath, entry] of entries) {
    const path = normalizePath(rawPath);
    if (path !== rawPath) throw new Error(`Use a clean absolute path: ${rawPath}`);
    ensureParents(path);
    if (entry.type === "dir") {
      addDir(path, entry);
      continue;
    }
    const lines = entry.binary || entry.denied ? null : fileLines(entry, config);
    const executable = entry.mode ? entry.mode.includes("x") : false;
    nodes.set(path, {
      path,
      name: splitPath(path).name,
      type: "file",
      owner: entry.owner ?? "root",
      group: entry.group ?? entry.owner ?? "root",
      mode: entry.mode ?? "-rw-r--r--",
      mtime: entry.mtime ?? DEFAULT_MTIME,
      lines,
      binary: entry.binary ?? null,
      denied: entry.denied === true,
      executable,
      size: entry.size ?? (lines ? textSize(lines) : 0),
    });
  }

  const children = new Map();
  for (const node of nodes.values()) if (node.type === "dir") children.set(node.path, []);
  for (const node of nodes.values()) {
    if (node.path === "/") continue;
    children.get(splitPath(node.path).dir).push(node.name);
  }
  for (const names of children.values()) names.sort(compareNames);
  return { nodes, children };
}

/** Sort like `ls` in an English locale: ignore leading dots and case. */
export function compareNames(a, b) {
  const ka = a.replace(/^\.+/, "").toLowerCase();
  const kb = b.replace(/^\.+/, "").toLowerCase();
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
