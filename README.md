# five-nights-soc
A survival-style cybersecurity training game: work five SOC night shifts with hands-on phishing, terminal, log hunt, and incident response labs. Built for Security+ practice.

## Run locally

```sh
npm install
npm run dev      # http://localhost:8787
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
| `public/index.html` | Page layout: HUD, briefing, inbox, and results screens |
| `public/css/style.css` | All styles (dark SOC theme, flag states, tooltip, mobile layout) |
| `public/js/night1.js` | Night 1 game logic: renders emails, hover inspection, flagging, scoring, clock, ranks |
| `public/js/storage.js` | Saved progress in localStorage, wrapped in try/catch and validated on read |
| `public/data/night1.json` | Night 1 content and difficulty config (emails, XP values, ranks, shift length) |
| `public/404.html` | Not-found page |
