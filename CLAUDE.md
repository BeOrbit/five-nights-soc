# 5 Nights in the SOC

A survival-style cybersecurity training game. The player is a night-shift SOC analyst at a fictional company, **Kestrel Logistics**, and must survive five night shifts (12 AM to 6 AM), each harder than the last. Built for hands-on CompTIA Security+ (SY0-801) practice.

Owner: Javon Mentore (GitHub: BeOrbit). Student project, also a portfolio piece for cybersecurity internships.

## Tech stack
- Hosting: Cloudflare Workers (Worker name `five-nights-soc`, account subdomain `beorbit`)
- Front end: plain HTML, CSS, and JavaScript (no framework, no game engine)
- Game content: JSON files per night (for example `data/night1.json`)
- Progress: browser localStorage first (wrap reads and writes in try/catch); leaderboard later with a Worker API and D1
- Night 2 terminal: a small custom terminal written in plain JS (not xterm.js; see "Security decision" under Night 2)
- Tests: `npm test` runs Node's built-in test runner (`node --test`) over `test/`; no test framework
- Developed on a MacBook; code pushed to GitHub (BeOrbit/five-nights-soc)

## Rules
- Everything original: no art, sounds, characters, or names from Five Nights at Freddy's.
- Do not use "Security+" or "CompTIA" in the game's name or branding; describing it as Security+ practice is fine.
- All companies, people, domains, and emails in the game are fictional. Never imitate real brands or real login pages.
- Write every question and scenario from scratch, mapped to the public SY0-801 exam objectives. Never copy from CompTIA or paid practice banks.
- Difficulty settings live in one config per night, so tuning a night means changing numbers, not code.
- Build the site securely (input validation, rate limits on any API, security headers). It is part of the portfolio story.

## The five nights
| Night | New skill | Build target |
| --- | --- | --- |
| 1 | Phishing inbox: Report or Trust each email | Thanksgiving break 2026 |
| 2 | Terminal: run commands to trace an attacker | January 2027 |
| 3 | Log hunt: find the attack in thousands of log lines | February 2027 |
| 4 | Lockdown: drag and drop firewall rules and controls | March 2027 |
| 5 | Full incident: every skill at once, survive until 6 AM | Summer 2027 |

## Difficulty ramp
| | Night 1 | Night 2 | Night 3 | Night 4 | Night 5 |
| --- | --- | --- | --- | --- | --- |
| Phishing | Obvious tells | Subtle lookalike domains | Replies inside real threads | Appears to come from coworkers | Phishing started the night's attack; trace it |
| Clock | Plenty of time | Slightly faster | Alerts interrupt | Strict timer | Every second counts |
| Hints | Hover tooltips | Fewer tooltips | "?" button costs XP | None | None |
| Mistakes | -50 XP | -75 XP | -100 XP | Wrong call lets the attack spread | Three wrong calls = breach (game over) |

Later nights also use fewer red flags per email, legitimate emails that look suspicious, and more volume (10 emails on Night 1, 25 mixed with alerts on Night 4).

## Night 1: phishing inbox
Employees forward suspicious emails to the analyst. Each email handled advances the clock. The player can hover the sender to see the real address, hover links to see the real destination, and inspect attachment names, then choose **Report** (phishing) or **Trust** (legitimate). Emails go from easiest to hardest.

| # | Subject | Verdict | Tell |
| --- | --- | --- | --- |
| 1 | Quick favor, need gift cards ASAP | Phishing | CEO's name but a Gmail address; urgency and secrecy |
| 2 | Delivery failed: see invoice | Phishing | Attachment `Invoice_8841.pdf.exe` |
| 3 | Your password expires in 24 hours | Phishing | Sender `kestre1-logistics.com` (1 instead of l); link goes to `verify-acct.net` |
| 4 | Team sync moved to Thursday | Legitimate | Normal coworker calendar invite, no links |
| 5 | A document was shared with you | Phishing | "Dear user" greeting; link to an `http://` unknown domain |
| 6 | Updated 2027 holiday schedule | Legitimate | Correct HR address; link to the company intranet |
| 7 | Direct deposit change confirmed | Phishing | Change you never requested; "log in to cancel" link |
| 8 | Scheduled maintenance tonight at 2 AM | Legitimate | Signed by IT, no links, nothing asked |
| 9 | Updated bank details for invoice #2291 | Phishing | Known vendor, but different reply-to and a new payment account |
| 10 | Phishing awareness training due Friday | Legitimate | About phishing, but from the real security team address |

Scoring: +100 per correct call, +25 per red flag identified, -10 per false flag (flagging something that isn't a red flag), -50 per wrong call.
Ranks are set as a percent of the best possible score, so they scale as emails are added: Intern (0%), Tier 1 Analyst (40%), Tier 2 Analyst (70%), Night Shift Lead (90%).
Clock: the six-hour shift is split evenly across the emails (36 minutes each with 10), so the last call always lands on 6:00 AM. Progress bar, queue counts, and max XP are all derived from `emails.length`; adding an email needs no code change.
Security+ mapping: Domain 2 (threats, vulnerabilities, and mitigations), social engineering.

### Email data format (`public/data/night1.json`)
- `from` (display name plus real address, shown on hover), optional `replyTo`, `to`, `received`, `forwardedBy` and `forwardNote` (the employee who sent it to the SOC).
- `body`: paragraphs made of segments. A plain string is still clickable (so real red flags don't stand out); an object `{ id, text }` gives it a flag id, and adding `href` makes it a fake link with a hover destination.
- `attachments`: `displayName` is what the player sees, `fileName` and `fileType` are the truth shown on hover.
- `redFlags`: a map of flaggable id (`sender`, `replyTo`, attachment ids, or segment ids) to the explanation shown in feedback. Empty for legitimate emails.
- `explanation`: the paragraph shown after the call and in the end-of-shift review.
- Optional `calendar` card for meeting invites.

## Game screens and features (built for Night 1)
The site is styled as a 2000s Kestrel security workstation (SOC-WS-07) with a taskbar. The taskbar shows the active "window" title, the shift clock, XP, rank, and progress during a shift, a Log off button, a "?" button (inbox only), and a settings gear.

- **Main menu (login screen):** Kestrel workstation logon banner and a shift roster of all five nights. Night 1 is open and shows the saved best score; Nights 2 to 5 are listed as locked ("Clearance pending"). Buttons: How to Play, Settings, Credits.
- **How to Play memo:** a printed onboarding memo (KL-SOC-MEMO-0412) from Rhea Vance covering the job, how to inspect, how flagging works, scoring, ranks, and keyboard shortcuts. The scoring and rank tables are filled from the night's config, so they never go stale.
- **Shift handoff (briefing):** a handoff ticket with the night's briefing paragraphs, a legend, and shortcuts. "Acknowledge and start shift" begins the night.
- **Mail triage (inbox):** folders (SOC Queue, Reported, Trusted with counts), the queue list with ticket numbers (`INC-MMDD-0001`) and Open/Queued/Pass/Fail status tags, the email reader, and Report/Trust buttons. After each call, a feedback panel shows the verdict, an XP breakdown, the explanation, and every red flag marked Found or Missed. Flags in the email are revealed as found, missed, or not a flag.
- **End of shift report:** clock-out time, rank, stats (correct calls, red flags found, false flags, final XP), a personal-best message, and "Incidents for follow-up": every wrong call with the missed red flags and the explanation. Buttons: work the shift again, or log off to the main menu.
- **Settings dialog:** sound effects (tones generated in the browser), reduce motion (also turns off smooth scrolling and the CRT scanlines; the OS setting is always respected), larger text (about 25% bigger), and Reset progress behind a second confirmation dialog. Settings and progress are saved in localStorage with try/catch, and the game works if storage is blocked.
- **Credits dialog:** author, Security+ practice disclaimer (not affiliated with CompTIA), fictional-content note, font license, and source link.

### Quality-of-life features
- Keyboard shortcuts: R report, T trust, arrow keys move between emails (and go to the next email after a call), Tab and Enter inspect and flag without a mouse, ? reopens the handoff in a dialog mid-shift.
- Touch support: the first tap on a sender, link, or attachment inspects it; a second tap flags it.
- Review past emails during a shift: click back to any handled email to see it read-only with its verdict and flag review, then jump back to the current one. Flags on the current email are kept while you look back.
- Log off mid-shift asks for confirmation so progress isn't lost by accident.
- Progress bar and "N left" queue count; XP number animates when it changes.
- Accessibility: status is always spelled out in words, not color alone; tooltips are announced as the focused element's description; dialogs trap the keyboard; the progress bar has ARIA values.
- Security: all email content is inserted with `textContent`, never `innerHTML`, and links in emails are spans, so the game never navigates anywhere.

## Launch plan for Night 1
- Fri Nov 27: project structure and inbox layout with the first 5 emails
- Sat Nov 28: hover-to-inspect, Report/Trust, XP and ranks
- Sun Nov 29: all 10 emails, deploy to `five-nights-soc.beorbit.workers.dev`, push to GitHub

## Night 2: the terminal (approved plan)
Shift date: Saturday, November 28, 2026, 12 AM to 6 AM. Unlocks from the main menu once Night 1 has a saved result (any score); resetting progress locks it again.

### Story
Rhea Vance's handoff: Jordan Pike (Night 1, email 3) admitted clicking the password-expiry link *before* forwarding it, and typed their password into `verify-acct.net`. IT reset the password Friday at 4:50 PM, but the dispatch reporting server **kl-rpt-01** accepts the same company login and is reachable from outside. The player gets a read-only forensic session as `soc-analyst` and fills out a case file.

What really happened (the player rebuilds this):
- Fri Nov 27, 12:07 AM: phish arrives; about 12:10 AM Jordan enters the password.
- 3:14 AM: attacker logs in over SSH as `jpike` from `203.0.113.47` (while the Night 1 player was on shift).
- 3:15 to 3:41 AM: recon, failed `sudo cat /etc/shadow`, copies dispatch exports to hidden `/tmp/.cache-x/`, tars them into `sys-update.tgz`, downloads hidden script `~/.local/share/.sysd-update.sh` from 203.0.113.47 with `curl`, schedules it with cron every 15 minutes, logs out.
- 4:50 PM: password reset. The cron job keeps running anyway. Core lesson: a password reset doesn't remove persistence.
- The attacker's commands survive in `~jpike/.bash_history` because Kestrel's audit policy (`/etc/profile.d/kestrel-audit.sh`, `shopt -s histappend` plus `PROMPT_COMMAND='history -a'`) writes each command to disk as it runs, so a dropped session or `history -c` (which only clears the shell's memory) can't erase it. Tested on real bash: with this policy, every earlier command stays in the file, but `history -c` itself is never written. So the game never claims the attacker ran `history -c`; there would be no evidence for it.
- Hook for Night 3: the archive is staged but not yet sent. Did anything leave?

All IPs are from documentation ranges (203.0.113.0/24, 198.51.100.0/24) or private 10.x space.

### File system (★ clue, ◇ decoy)
```
/etc/motd, /etc/passwd (jpike, mreyes, svc-backup, dispatch, soc-analyst)
/etc/crontab                              ◇ normal system jobs
/etc/profile.d/kestrel-audit.sh           ★ PROMPT_COMMAND='history -a'
/home/soc-analyst/CASE-README.txt         start here; says logs live in /var/log, and that the forensic account can read root-only folders like /var/spool/cron
/home/jpike/notes.txt                     ◇ mentions working from home over VPN
/home/jpike/route_reports/*.csv           ◇ normal reports
/home/jpike/.bash_history                 ★ Jordan's normal commands, then the attacker's
/home/jpike/.local/share/.sysd-update.sh  ★ persistence script ("keepalive" to 203.0.113.47; display text only)
/home/mreyes/.bash_history                ◇ another dispatcher copying exports for a real reason
/srv/dispatch/config/rptd.conf
/srv/dispatch/exports/                    customers_2026Q4.csv, driver_roster.csv, fuel_card_usage.csv
/tmp/rptd.lock
/tmp/.cache-x/sys-update.tgz              ★ staged archive (hidden folder, 2.3 MB, Nov 27 03:33)
/var/log/auth.log                         ★ the successful login inside ~240 noise lines
/var/log/auth.log.1                       ◇ older, normal activity only
/var/log/syslog                           ★ CRON lines running jpike's script every 15 minutes
/var/spool/cron/crontabs/jpike            ★ the malicious cron entry
/var/spool/cron/crontabs/svc-backup       ◇ legitimate backup job
```
`last` and `ps` read from simulated tables in the night data, not files.

### Clues
| # | Clue | Where |
| --- | --- | --- |
| 1 | `Accepted password for jpike from 203.0.113.47 port 51122 ssh2` at Nov 27 03:14:22 (after one failed try from the same IP) | auth.log |
| ◇ | ~200 `Failed password for root/admin/oracle from 198.51.100.23`: brute force that never succeeds | auth.log |
| ◇ | `Accepted password for jpike from 10.40.12.88`, Nov 26 2:02 PM: Jordan's real VPN login | auth.log |
| 2 | `jpike : user NOT in sudoers ; ... COMMAND=/bin/cat /etc/shadow` at 03:16 | auth.log |
| 3 | `jpike pts/1 203.0.113.47 Fri Nov 27 03:14 - 03:41 (00:27)`; `soc-analyst ... still logged in` is the player | `last` |
| 4 | The attacker's commands after Jordan's normal ones | `/home/jpike/.bash_history` (needs `ls -a`) |
| 5 | Hidden `.cache-x` folder with `sys-update.tgz` | `/tmp` (needs `ls -a`) |
| 6 | `*/15 * * * * /home/jpike/.local/share/.sysd-update.sh >/dev/null 2>&1` | `/var/spool/cron/crontabs/jpike` |
| 7 | `CRON[...]: (jpike) CMD (...sysd-update.sh...)` every 15 minutes, still running after the reset | `/var/log/syslog` |
| 8 | Script contents tie the persistence to the attacker IP | `.sysd-update.sh` (needs `ls -a`) |
| 9 | The script running as jpike right now | `ps` |
| 10 | Why the history is on disk at all (`history -a` after every command) | `/etc/profile.d/kestrel-audit.sh` (debrief only) |

### Commands
`help`, `whoami`, `id`, `hostname`, `pwd`, `date` (in-game clock), `ls [-a] [-A] [-l] [-1] [path...]` (names two spaces apart; one per line with `-1`, into a pipe, or on a phone-width screen), `cd` (`..`, `~`, `~user`, `-`, absolute, relative), `cat file...`, `grep [-i] [-n] [-c] [-v] [-r] [-h] text file...` (plain text match, not regex), `head` / `tail` with `-n N`, `-nN`, or `-N` (default 10; `tail -n +N` starts at line N), `history [n]` (the player's own session, as in real bash), `last [user]`, `ps` (own processes) and `ps aux` / `ps -ef` (everyone's), `clear`.

- Pipes: any command can pipe into `grep`, `head`, or `tail`, and they chain (`cat /var/log/syslog | grep CMD | tail -n 5`). Only those three read a pipe. Errors skip the pipe, like stderr.
- Globs: `*` and `?` in the last part of an unquoted path (`ls /var/log/auth*`).
- Refused, without changing anything: write commands (`rm`, `cp`, `mv`, `crontab`, `kill`, `tar`, editors, and so on) say "Read-only forensic session: kl-rpt-01 is evidence. Nothing was changed." Network tools (`curl`, `wget`, `scp`, `ssh`, and so on) say they're disabled, so the player never contacts the attacker. `sudo` and `su` say the forensic account isn't a sudoer. `;`, `&&`, `||`, `>`, `<`, backticks, and `$(` are refused (one command at a time).
- `/etc/shadow`, `/root`, and `/srv/dispatch/config/.db_pass` are permission denied, even for the forensic account.
- Anything else is `bash: NAME: command not found`. Unknown commands, usage errors (no file given, bad option, bad `-n` value, piping into a command that can't read a pipe), `exit`, and empty lines don't cost clock time. A real lookup that fails, like `cat /nope`, still costs time.
- Evidence detection looks only at what's on screen, never at which command ran. Each output line carries `shows` (the server paths whose names or content it reveals), and that survives pipes. A clue matches `{ output, from }` (a line of that file's content containing the text) or `{ shows: path }` (the path or anything inside it was listed or printed). Error, warning, and note lines and the player's own `history` never count. Every clue can be found several ways (`cat`, `grep`, `head`/`tail`, `grep -r`, pipes, `ls -a`/`-A`/`-la`); `test/shell.test.js` checks at least two per clue.
- Tab completes commands and paths (hidden names only when the typed prefix starts with a dot).

Safety: the shell is a pure interpreter over a JS object (`public/js/terminal/shell.js`). No `eval`, no network, nothing executes. Input is capped (config) and control/escape characters are stripped.

### Case file (answers stored as SHA-256 hashes)
| # | Question | Input | Answer | Decoys |
| --- | --- | --- | --- | --- |
| 1 | Account the attacker used | text | `jpike` | root, svc-backup |
| 2 | Attacker IP | text (IPv4) | `203.0.113.47` | 198.51.100.23, 10.40.12.88 |
| 3 | Commands the attacker ran | checklist of 8, exact set (options describe actions, so they don't leak paths or IPs) | tried `sudo cat /etc/shadow`, `cp` the exports, `tar` an archive, `curl` download, add a crontab entry | `useradd`, `scp` an archive off the server, `rm -rf /var/log` |
| 4 | How the attacker gets back in | mechanism + path, both right | cron job, `/home/jpike/.local/share/.sysd-update.sh` | SSH key, new user, systemd service |
| 5 | Where data is staged for theft | path | `/tmp/.cache-x/sys-update.tgz` (or `/tmp/.cache-x`) | `/srv/dispatch/exports` |

- `night2.json` never holds plaintext answers. Each question lists one or more `answerHashes`: SHA-256 (hex) of the normalized answer, checked in the browser with the Web Crypto API (`public/js/answers.js`).
- Normalizing: trim and lowercase. Path fields also drop trailing slashes. Checklists hash the sorted option ids joined by `,`. Multi-part answers join their normalized parts with `|` (for example `cron|/home/jpike/.local/share/.sysd-update.sh`).
- The plaintext key lives in `test/answer-key.local.json`, which is **gitignored and never committed** (answers, decoy answers, and evidence needles). `test/night2.test.js` checks it against the hashes when the file exists, so data and key can't drift, and skips those four checks when it doesn't (a fresh clone).
- Honest limits: answers like an account name or an IP are low entropy and could be brute-forced from the hashes, and the evidence itself contains the answers (that's the game). Hashing keeps an answer key out of plain sight; it isn't anti-cheat. **Real scoring moves to the Worker when the leaderboard is added**, so a submitted score can't be faked from the browser.

Scoring: +100 per correct answer, -75 per wrong or blank answer, +25 per key clue actually shown on screen (clues 1, 4, 5, 6 or 7, 8). Max 625 XP; ranks use the same percent thresholds as Night 1. The case file is submitted once, after a confirmation that lists blank fields. The end-of-shift report shows Pass/Fail per answer with the evidence location, the attack timeline, and recommendations (remove cron job and script, MFA on remote logins, SSH only over VPN, report clicks even after forwarding).

Security+ mapping: Security Operations (incident response, using data sources such as logs, shell history, and scheduled tasks in an investigation) and Domain 2 (indicators of malicious activity, credential compromise). Check exact wording against the published SY0-801 objectives before writing memo text.

### Difficulty (all in `night2.json` config)
- Hints: tooltips only on case-file field labels; CASE-README gives one starting point; no hint command.
- Clock: each command advances the clock 5 minutes (72 commands to 6 AM). Unknown commands, usage errors, empty lines, and the commands in `config.freeCommands` (`help`, `clear`, `history`) are free. Warnings print at the minutes-left marks in `config.clockWarningsMinutesLeft` (60 and 15). At 6:00 AM the session closes and the case file is filed as is (`config.autoSubmitAtShiftEnd`); invalid input then scores as wrong.
- Mistakes: -75 XP per wrong case-file answer.

### Security decision: custom terminal instead of xterm.js
xterm.js injects `<style>` elements at runtime, which our CSP (`style-src 'self'`) blocks. Rather than loosen the CSP with `'unsafe-inline'`, we chose on purpose to build a small terminal ourselves: a command line, history with up and down arrows, Tab completion, and scrollback, all rendered with `textContent` and styled from `style.css`. We give up xterm's full terminal emulation (which this game doesn't need) and keep a strict CSP with no inline styles or scripts. That trade-off is part of the portfolio story.

### Accessibility and reuse
Reuse the shared menu, taskbar, XP, ranks, settings, and dialogs. Larger text scales the terminal (all sizes are rem). The command line is a real `<input>` using the browser's own caret (amber via `caret-color`), so we don't animate a fake cursor; the caret follows the OS's settings, and reduce motion still turns off every animation we add. Each command's results are read out through a polite live region; output over 10 lines is summarized ("…and N more lines. Press Shift+Tab to read the full output"), and the scrollback itself is a focusable `role="log"` region. Tab completes inside the terminal; Esc then Tab moves focus out, and Shift+Tab always moves back to the output, so the terminal never traps keyboard users. Add a Night 2 section to the How to Play memo (chunk 3).

### Build chunks
1. **Done.** Engine and plumbing (no new UI): move shared code out of `night1.js` (Night 1 must play exactly the same), Night 2 unlock state in the roster, `data/night2.json` (file system, logs, `last`/`ps` tables, config, hashed answers), `js/terminal/shell.js` (pure interpreter, every command), `js/answers.js` (normalize and hash), and `node --test` unit tests.
2. **Done.** Terminal screen: custom terminal component (prompt, history, Tab completion, scrollback), handoff screen, clock per command, clue tracking, read-only messages, settings and accessibility wiring.
3. **Done.** Case file and wrap-up: case-file panel with input validation and hashed checking, scoring, auto-submit at 6 AM, end-of-shift report with timeline and evidence, Night 2 memo section, mobile pass, headless-browser run of a full shift, update CLAUDE.md.

### Chunk 1 status (done)
- Shared code moved out of `night1.js`: `js/app.js` (entry point: menu, roster unlocks, memo, credits, log off, settings), `js/screens.js` (screen switching and taskbar), `js/ui.js` (DOM and format helpers), `js/ranks.js` (rank math). Night 1 exports `init`, `load`, `openBriefing`, `openBriefingDialog`, `isShiftInProgress`, and `onProgressReset`.
- Roster: Night 2 shows **Cleared** once Night 1 has a saved result and **Locked** otherwise (also after Reset progress). Its Start button arrives with the terminal screen in chunk 2.
- `js/terminal/filesystem.js` builds the fake file system from `night2.json`. Repetitive log lines (brute force, cron sessions) come from seeded generator specs, so logs are identical every run and the brute-force volume is a config number (`config.noise.bruteForceAttempts`).
- `js/terminal/shell.js`: the interpreter (`createShell(data, { now })` returns `run`, `complete`, `prompt`, `cwd`, `history`), plus `sanitizeInput`, `tokenize`, and `matchClues`.
- `js/answers.js`: validation, normalizing, and SHA-256 checking. `scripts/hash-answer.js` prints a hash for a new answer.
- Tests: `test/shell.test.js`, `test/answers.test.js`, `test/night2.test.js` (hash checks against the local answer key, decoys, evidence and clue reachability, documentation-only IPs). `package.json` now has `"type": "module"` and `npm test`.

### Chunk 2 status (done)
- Screens: `n2-briefing` (case handoff: case id, server, clock cost, priority, terminal legend and keys) and `terminal` (scrollback and command line on the left, evidence log and session stats on the right). The roster's **Start Night 2** button appears once Night 2 is unlocked. The taskbar "?" reopens the handoff in `#n2-help-dialog`, and Log off asks first while the session is open.
- `js/terminal/terminal.js`: the DOM terminal. Real `<input>` command line, Enter, Up/Down history (keeps the unfinished line), Tab completion (lists the choices when nothing more can be filled in, like a double Tab in bash), Ctrl+L, Ctrl+C, click the scrollback to refocus, scrollback capped at `config.scrollbackLines`, and on-screen Tab/↑/↓ keys on touch screens and phones. All text goes in with `textContent`.
- `js/night2.js`: runs each line through the shell, echoes the sanitized input, prints results (errors red, read-only and network refusals amber, notes muted), moves the clock, and logs clues. A new clue prints an "Evidence logged" line, earns `xp.clueFound`, plays the correct tone, and adds a timestamped row to the evidence log. The tray shows clock, XP, rank, and "N of 5 evidence found"; the status bar shows commands left. At 6:00 AM the input locks and a "Shift over" panel offers the way back to the menu. Chunk 3 replaces that panel with the case file and report.
- Checked under `wrangler dev` with the real CSP: no violations, no console errors, desktop and phone layouts, larger text, reduce motion, a full run to 6:00 AM, and Night 1 unchanged.

### Chunk 3 status (done)
- Side pane: two ARIA tabs, **Evidence** and **Case file**, each with a live count (`3/5`). Arrow keys, Home, and End move between tabs. On desktop the pane is exactly as tall as the terminal and scrolls inside itself (`contain: size`); at 1000px and below it stacks under the terminal at its natural height.
- `js/casefile.js`: builds the case file from `night2.json` (text, IPv4, and path inputs; the checklist as checkboxes in a `<fieldset>`; mechanism-path as a radio group plus a path input). Each field has a **?** button that toggles its tip (Night 2's only hints; a toggled paragraph instead of a hover tooltip, so it works with keyboard, screen reader, and touch). Validation uses `prepareResponse` from `answers.js`: errors show on blur and on filing, clear as soon as the input is fixed, and set `aria-invalid`. Inputs have `maxlength`, no autocorrect, and 16px text on phones. Player input is never inserted into the page.
- Filing: "File case report" validates every field first (invalid input blocks filing, shows a summary, and focuses the first bad field), then `#n2-submit-dialog` confirms and lists blank fields. Filing closes the session early; the filed time is shown on the report. At 6:00 AM it files automatically.
- `answers.js` adds `gradeCaseFile`, `caseFileXp`, and `isBlankResponse` (pure, tested in Node). Final XP = 25 per clue found + 100 per right answer - 75 per wrong, blank, or invalid answer (it can go below zero). Best score saved with `saveNightResult(2, ...)`.
- Report screen `n2-results`: filed time (by you or automatically), rank, stats (answers right, evidence found, commands run, evidence XP, case file XP, final XP), personal best, "Work the case again" and log off. Then Pass/Fail for each answer with what the player wrote, where the evidence was, and the explanation; the attack timeline (steps tied to a clue are tagged Seen or Not seen); the audit note on why `.bash_history` survived (says whether the player read `/etc/profile.d/kestrel-audit.sh`; no XP); recommendations; and the Night 3 hook.
- `night2.json` gains `debrief` (`timeline`, `audit`, `recommendations`, `nextNight`). `test/night2.test.js` checks that every timeline clue exists, every clue appears on the timeline, the audit match works, and max XP is 625.
- How to Play memo: Addendum A (sections 7 to 9) covers forensic cases, the case file, and terminal keys. The minutes-per-command, command count, and Night 2 XP table are filled from Night 2's config. The memo doesn't quote SY0-801 objective text (still to check against the published objectives).
- Checked with headless Chrome over CDP against `wrangler dev` (real CSP): Night 1 played through all 10 emails, Night 2 unlocked, a perfect Night 2 (625 XP, Night Shift Lead), a run to 6:00 AM that auto-filed (invalid and blank answers reported), the blank-field warning and cancel, log off mid-shift, and no console errors or CSP violations. Phone layouts checked at 390px and at 360px with larger text: no horizontal scrolling.

