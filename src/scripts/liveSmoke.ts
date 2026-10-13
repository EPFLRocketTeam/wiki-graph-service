/**
 * Minimal live smoke test against the real wiki: just list pages + fetch
 * ONE page's content, instead of a full ~1900-page crawl. Confirms the
 * GraphQL endpoint is reachable, the token works, and the field names in
 * wikiClient.ts actually match this wiki's schema, before we commit to a
 * full rebuild.
 */
import { listPages, getPageContent } from "../wikiClient";

async function run() {
  console.log("Fetching page list...");
  const pages = await listPages();
  console.log(`Got ${pages.length} pages.`);
  console.log("First 5:", pages.slice(0, 5));

  if (pages.length > 0) {
    const sample = pages[0];
    console.log(`\nFetching content for page ${sample.id} (${sample.path})...`);
    const content = await getPageContent(sample.id);
    if (content) {
      console.log("Got content, length:", content.content?.length ?? 0);
      console.log("First 300 chars:\n", content.content?.slice(0, 300));
    } else {
      console.log("getPageContent returned null");
    }
  }
}

run().catch((err) => {
  console.error("LIVE SMOKE TEST FAILED:");
  console.error(err);
  process.exit(1);
});
