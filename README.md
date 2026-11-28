# five-nights-soc
A survival-style cybersecurity training game: work five SOC night shifts with hands-on phishing, terminal, log hunt, and incident response labs. Built for Security+ practice.

## Run locally

```sh
npm install
npm run dev      # http://localhost:8787
npm test         # unit tests
```

## Deploy

```sh
npx wrangler login   # first time only
npm run deploy       # https://five-nights-soc.beorbit.workers.dev
```

## Project layout

| Path | What it is |
| --- | --- |
| `wrangler.jsonc` | Cloudflare Workers config: Worker name, entry point, static assets folder |
| `src/index.js` | The Worker: serves `public/` and adds security headers to every response |
| `public/index.html` | Page layout: main menu, How to Play memo, and each night's screens |
| `public/css/style.css` | All styles (2000s workstation theme, flag states, tooltip, mobile layout) |
| `public/js/app.js` | Entry point: main menu, shift roster and unlocks, memo, credits, log off, settings |
| `public/js/screens.js` | Screen switching and the taskbar |
| `public/js/ui.js`, `public/js/ranks.js` | Shared DOM/format helpers and rank math |
| `public/js/night1.js` | Night 1 game logic: renders emails, hover inspection, flagging, scoring, clock |
| `public/js/terminal/` | Night 2's simulated, read-only shell and fake file system (no real commands run) |
| `public/js/answers.js` | Case-file answer validation and SHA-256 checking |
| `public/js/storage.js` | Saved progress in localStorage, wrapped in try/catch and validated on read |
| `public/data/night1.json`, `night2.json` | Night content and difficulty config |
| `public/404.html` | Not-found page |
| `scripts/hash-answer.js` | Prints the hash of a case-file answer for the night data |
| `test/` | Unit tests (`npm test`, Node's built-in test runner) |
