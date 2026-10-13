# wiki-graph-service

Backend for the "Obsidian-style graph view" button on the EPFL Rocket Team
Wiki.js. Periodically crawls the wiki via its GraphQL API, parses internal
links out of every page's content, and serves a small REST API that the
button (injected into the wiki via admin -> Theme -> Code Injection -> Head
HTML Injection, same mechanism as the existing PDF/copy-page-id script)
calls with the current page's ID to get back a local graph (that page + its
neighbors, like Obsidian's local graph).

Status: **backend only, not yet deployed.** The frontend (the actual popup
+ graph rendering + visual style) is intentionally not built yet -- Jordan
is waiting on Hugo's input on style and exactly which links/depth to show.
Nothing here depends on that, so this part can be finished and tested
independently.

## What's here

- `src/wikiClient.ts` -- talks to the wiki's `/graphql` endpoint (page list
  + page content).
- `src/linkParser.ts` -- extracts internal link candidates (markdown-style
  and raw `<a href>`) out of a page's raw content.
- `src/graphBuilder.ts` -- resolves link candidates to page IDs, builds the
  full directed link graph (+ computed backlinks), and the BFS that turns
  it into a "local graph" around one page.
- `src/graphStore.ts` -- holds the current graph in memory, persists it to
  `data/graph.json` so a restart doesn't start from zero, triggers rebuilds.
- `src/api.ts` / `src/index.ts` -- the Express server + scheduled rebuilds.

## Before running this for real

1. **Fill in `.env`** (copy from `.env.example` if starting fresh -- a
   first draft `.env` already has the read-only API token you generated).
   Still need: `WIKI_BASE_URL` (e.g. `https://wiki.epflrocketteam.ch`).

2. **Verify the GraphQL field names against the live schema.** I wrote
   `wikiClient.ts` against the documented/typical Wiki.js 2.x schema
   (`pages.list { id path title locale }`, `pages.single(id) { content }`),
   but I haven't been able to run a live query against this wiki yet since I
   don't have its URL. Once `.env` is filled in, run:

   ```
   npm install
   npm run rebuild-graph
   ```

   This does one rebuild and prints the stats, without starting the HTTP
   server -- the fastest way to see if the queries actually match this
   wiki's schema. If it errors with something like `Cannot query field
   "content" on type "Page"`, open `<WIKI_BASE_URL>/graphql` in a browser
   (Wiki.js serves a GraphQL Playground there) and check the real field
   names in the schema docs panel on the right, then fix the two queries in
   `src/wikiClient.ts`.

3. **Sanity-check the numbers.** The rebuild prints page count, edge count,
   and "unresolved link targets" (links we found in page content but
   couldn't match to a known page -- expected to be non-zero for truly
   external links or typos, but if it's close to the total link count,
   something's off with path/locale normalization in `graphBuilder.ts`).

## Running

```
npm install
npm run dev          # local dev server with auto-reload, reads .env
npm run build && npm start   # production-style run
```

## API

- `GET /api/health` -- `{ ok, building, lastError, builtAt, stats }`
- `GET /api/graph/:pageId?depth=1` -- local graph around one page
  (`depth` 1-5, default from `.env`): `{ builtAt, center, depth, nodes, edges }`
- `GET /api/graph` -- full graph dump (debugging)
- `POST /api/rebuild` -- trigger a rebuild now, needs header
  `x-rebuild-secret: <REBUILD_SECRET from .env>`. Useful later for a
  Wiki.js webhook on page save, so the graph doesn't lag behind edits by a
  full cron cycle.

## Deploying on Dokploy

There's a `Dockerfile` (multi-stage build). In Dokploy: new app from this
repo, point it at the Dockerfile, set the same env vars as `.env` in the
app's environment settings (**do not** commit `.env` -- it's gitignored),
and mount `/app/data` as a volume if you want the cached graph to survive
redeploys (otherwise it just rebuilds on the next cron tick after a
restart, no big deal for a ~1900-page wiki).

## Open items / things to confirm with Jordan & Hugo

- Exact GraphQL field names (see "Before running this for real" above).
- This wiki's locale setup -- `graphBuilder.ts` guesses a locale prefix by
  pattern (`/en/...`, `/fr/...`) when resolving links; worth confirming
  there's nothing fancier going on (e.g. locale-specific duplicate pages)
  once we see real data.
- Backlinks vs outgoing-only, local-graph depth default, and full-wiki view
  -- waiting on Hugo's answer, mentioned in Slack.
- Whether to add a `POST /api/rebuild` webhook call from Wiki.js on page
  save (nice-to-have, not needed for v1).

## Security note

The API token in `.env` was pasted directly into chat while scoping this
out. It's read-only (page content only), so the blast radius if it leaked
is small, but once this is deployed and the token lives in Dokploy's env
settings, it's worth regenerating it in Wiki.js (API Access) and swapping
in the new one, just so the one that was typed in chat stops being valid.
