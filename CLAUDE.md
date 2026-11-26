# 5 Nights in the SOC

A survival-style cybersecurity training game. The player is a night-shift SOC analyst at a fictional company, **Kestrel Logistics**, and must survive five night shifts (12 AM to 6 AM), each harder than the last. Built for hands-on CompTIA Security+ (SY0-801) practice.

Owner: Javon Mentore (GitHub: BeOrbit). Student project, also a portfolio piece for cybersecurity internships.

## Tech stack
- Hosting: Cloudflare Workers (Worker name `five-nights-soc`, account subdomain `beorbit`)
- Front end: plain HTML, CSS, and JavaScript (no framework, no game engine)
- Game content: JSON files per night (for example `data/night1.json`)
- Progress: browser localStorage first (wrap reads and writes in try/catch); leaderboard later with a Worker API and D1
- Night 2 terminal: xterm.js (later)
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

Scoring: +100 per correct call, +25 per red flag identified, -50 per wrong call.
Ranks by XP: Intern, Tier 1 Analyst, Tier 2 Analyst, Night Shift Lead.
Security+ mapping: Domain 2 (threats, vulnerabilities, and mitigations), social engineering.

## Launch plan for Night 1
- Fri Nov 27: project structure and inbox layout with the first 5 emails
- Sat Nov 28: hover-to-inspect, Report/Trust, XP and ranks
- Sun Nov 29: all 10 emails, deploy to `five-nights-soc.beorbit.workers.dev`, push to GitHub
