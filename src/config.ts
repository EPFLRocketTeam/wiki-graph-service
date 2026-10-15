import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return v;
}

export const config = {
  wikiBaseUrl: required("WIKI_BASE_URL").replace(/\/+$/, ""),
  wikiApiToken: required("WIKI_API_TOKEN"),
  port: Number(process.env.PORT ?? 4000),
  rebuildCron: process.env.REBUILD_CRON ?? "0 */6 * * *",
  rebuildSecret: process.env.REBUILD_SECRET ?? "",
  fetchConcurrency: Number(process.env.FETCH_CONCURRENCY ?? 5),
  // Safety cap on how many nodes a single /api/graph/:pageId response can
  // contain. Local graphs are unbounded-depth by default (see
  // graphBuilder.localGraph) -- this is what stops a handful of true hub
  // pages (e.g. the wiki's intro) from returning a near-whole-wiki blob.
  defaultMaxGraphNodes: Number(process.env.DEFAULT_MAX_GRAPH_NODES ?? 150),
  // The browser-side fetch() from the wiki's injected button is what needs
  // CORS -- restrict it to the wiki's own origin in production. Falls back
  // to WIKI_BASE_URL (so it's locked down even if ALLOWED_ORIGIN is
  // forgotten), or can be overridden explicitly, e.g. to allow a local dev
  // copy of the wiki too.
  allowedOrigin: (process.env.ALLOWED_ORIGIN ?? "").replace(/\/+$/, ""),
};

export const graphqlEndpoint = `${config.wikiBaseUrl}/graphql`;
