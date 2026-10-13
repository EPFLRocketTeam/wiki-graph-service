/**
 * Extracts candidate internal-wiki-link paths out of a page's raw content.
 *
 * Wiki.js pages can be authored in different formats (Markdown is the
 * default/most common, but HTML/other editors exist), and links can be
 * written either as `/some/path` or `/en/some/path` (locale-prefixed,
 * e.g. when inserted via the page picker) or as a full URL pointing back
 * at the wiki itself. This does a best-effort regex extraction rather than
 * a full parser -- good enough for building a "related pages" graph, not
 * meant to be a strict linter.
 */

// Negative lookbehind excludes image embeds (`![alt](url)`) -- those point
// at uploaded assets, not wiki pages, and on an engineering wiki full of
// diagrams/photos they'd otherwise massively outnumber real page links.
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_HREF_RE = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

const SKIP_PREFIXES = ["mailto:", "tel:", "javascript:", "#"];

// A trailing "<name>.<ext>" segment means this points at an uploaded file
// (image, PDF, attachment, ...), not a wiki page -- Wiki.js page paths are
// plain slugs, they don't carry file extensions.
const ASSET_EXTENSION_RE = /\.[a-zA-Z0-9]{1,5}$/;

export function extractRawHrefs(content: string): string[] {
  const hrefs: string[] = [];

  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    hrefs.push(match[1]);
  }
  for (const match of content.matchAll(HTML_HREF_RE)) {
    hrefs.push(match[1]);
  }

  return hrefs;
}

/**
 * Turns a raw href into a normalized wiki path candidate (no leading slash,
 * no query/hash), or null if it's clearly not an internal wiki link.
 *
 * Returns the path as found in the link -- may or may not have a locale
 * prefix. Resolving that against the actual page list happens in
 * graphBuilder, which tries both the as-is path and a locale-stripped
 * variant against its path index.
 */
export function normalizeInternalHref(
  href: string,
  wikiBaseUrl: string
): string | null {
  let h = href.trim();
  if (!h) return null;
  if (SKIP_PREFIXES.some((p) => h.toLowerCase().startsWith(p))) return null;

  // Some pages have a typo'd link like "/https://example.com/..." -- a full
  // external URL with a stray leading slash (looks like someone pasted a
  // URL into a "relative link" field). Strip leading slashes before
  // checking for a URL scheme so these are still recognized as external
  // rather than falling through as a bogus internal-path candidate.
  const schemeCheck = h.replace(/^\/+/, "");

  // Absolute URL: only keep it if it points at our own wiki.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(schemeCheck)) {
    if (!schemeCheck.startsWith(wikiBaseUrl)) return null; // external link, not a wiki page
    h = schemeCheck.slice(wikiBaseUrl.length);
    if (!h.startsWith("/")) h = "/" + h;
  }

  if (!h.startsWith("/")) {
    // Relative link (e.g. "./other-page" or "other-page") -- Wiki.js
    // generally doesn't use these for internal links, skip for now rather
    // than guess at the current page's directory.
    return null;
  }

  // Strip query string / hash fragment.
  h = h.split("?")[0].split("#")[0];

  // Strip leading/trailing slashes.
  h = h.replace(/^\/+/, "").replace(/\/+$/, "");

  if (!h) return null;

  // Looks like a file (asset/attachment), not a page -- skip it.
  if (ASSET_EXTENSION_RE.test(h)) return null;

  return h;
}

export function extractInternalLinkCandidates(
  content: string,
  wikiBaseUrl: string
): string[] {
  const raw = extractRawHrefs(content);
  const normalized = raw
    .map((h) => normalizeInternalHref(h, wikiBaseUrl))
    .filter((h): h is string => h !== null);
  return Array.from(new Set(normalized));
}
