/**
 * Standalone one-off rebuild, for testing against the real wiki without
 * starting the HTTP server. Run with: npm run rebuild-graph
 *
 * Prints the resulting stats and exits. Good first smoke test once
 * WIKI_BASE_URL + WIKI_API_TOKEN are filled in in .env -- if the GraphQL
 * queries have the wrong field names for this wiki's schema, this is
 * where that'll surface.
 */
import { loadFromDisk, rebuild } from "../graphStore";

async function run() {
  loadFromDisk();
  const graph = await rebuild();
  console.log("\nDone.");
  console.log(`Pages: ${graph.stats.pageCount}`);
  console.log(`Edges: ${graph.stats.edgeCount}`);
  console.log(`Unresolved link targets: ${graph.stats.unresolvedLinkCount}`);
  if (graph.stats.sampleUnresolvedPaths.length > 0) {
    console.log(`\nSample unresolved paths (up to 25, deduped):`);
    for (const p of graph.stats.sampleUnresolvedPaths) {
      console.log(`  - ${p}`);
    }
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
