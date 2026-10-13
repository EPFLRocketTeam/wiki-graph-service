/**
 * Diagnostic: search every page's raw content for a substring and print the
 * page + surrounding context for each hit. Run with:
 *   npx ts-node --transpile-only src/scripts/findString.ts "fr.hach.com"
 * (or: npm run find-string -- "fr.hach.com")
 *
 * Useful for tracking down exactly how a given string/link is written in
 * the wiki source, since Wiki.js's admin "Pages" search only searches
 * title/path, not full content.
 */
import { listPages, getPageContent } from "../wikiClient";

async function run() {
  const needle = process.argv[2];
  if (!needle) {
    console.error('Usage: find-string "<substring to search for>"');
    process.exit(1);
  }

  const pages = await listPages();
  console.log(`Searching ${pages.length} pages for: ${needle}\n`);

  let hits = 0;
  for (const page of pages) {
    const content = await getPageContent(page.id);
    if (!content?.content) continue;
    const idx = content.content.indexOf(needle);
    if (idx === -1) continue;

    hits++;
    const start = Math.max(0, idx - 80);
    const end = Math.min(content.content.length, idx + needle.length + 80);
    const context = content.content.slice(start, end);

    console.log(`--- page ${page.id} (${page.path}) ---`);
    console.log(JSON.stringify(context));
    console.log();
  }

  console.log(`Done. ${hits} page(s) contained the string.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
