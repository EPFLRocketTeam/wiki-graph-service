import pLimit from "p-limit";
import { config } from "./config";
import { listPages, getPageContent, WikiPageListItem } from "./wikiClient";
import { extractInternalLinkCandidates } from "./linkParser";

export interface GraphNode {
  id: number;
  path: string;
  locale: string;
  title: string;
}

export interface GraphData {
  builtAt: string;
  nodes: Record<number, GraphNode>;
  edgesOut: Record<number, number[]>;
  edgesIn: Record<number, number[]>;
  stats: {
    pageCount: number;
    edgeCount: number;
    unresolvedLinkCount: number;
    sampleUnresolvedPaths: string[];
  };
}

// A link written as "/en/some/page" should resolve to the same page as one
// written as "/some/page" once we strip the locale segment. We don't know
// this wiki's exact locale list up front, so: try the path as-is first,
// then -- if the first segment looks like a short locale code -- try again
// without it.
const LOCALE_SEGMENT_RE = /^[a-z]{2}(-[a-z]{2})?$/i;

// This wiki has a page-ID shortlink convention: links written as "/i/123"
// (seen a lot in the real data -- looks like it comes from their existing
// "copy page ID" button) refer directly to the page with that numeric ID,
// not a path. Handle it before any path-based matching.
const ID_SHORTLINK_RE = /^i\/(\d+)$/;

function buildPathIndex(
  pages: WikiPageListItem[]
): { byPath: Map<string, number>; byPathLower: Map<string, number> } {
  const byPath = new Map<string, number>();
  const byPathLower = new Map<string, number>();
  for (const p of pages) {
    const key = p.path.replace(/^\/+/, "").replace(/\/+$/, "");
    byPath.set(key, p.id);
    // First match wins on case-insensitive collisions -- fine for a
    // best-effort fallback, real Wiki.js paths are case-sensitive and
    // shouldn't collide in practice.
    const lowerKey = key.toLowerCase();
    if (!byPathLower.has(lowerKey)) byPathLower.set(lowerKey, p.id);
  }
  return { byPath, byPathLower };
}

function resolvePathToId(
  path: string,
  index: { byPath: Map<string, number>; byPathLower: Map<string, number> },
  validIds: Set<number>
): number | null {
  const idShortlink = path.match(ID_SHORTLINK_RE);
  if (idShortlink) {
    const id = Number(idShortlink[1]);
    return validIds.has(id) ? id : null;
  }

  const direct = index.byPath.get(path);
  if (direct !== undefined) return direct;

  const segments = path.split("/");
  const withoutLocale =
    segments.length > 1 && LOCALE_SEGMENT_RE.test(segments[0])
      ? segments.slice(1).join("/")
      : null;

  if (withoutLocale !== null) {
    const viaLocaleStrip = index.byPath.get(withoutLocale);
    if (viaLocaleStrip !== undefined) return viaLocaleStrip;
  }

  // Last resort: case-insensitive match (authors sometimes hand-type links
  // with the wrong case). Try both the as-is and locale-stripped path.
  const viaLower = index.byPathLower.get(path.toLowerCase());
  if (viaLower !== undefined) return viaLower;
  if (withoutLocale !== null) {
    const viaLowerStripped = index.byPathLower.get(withoutLocale.toLowerCase());
    if (viaLowerStripped !== undefined) return viaLowerStripped;
  }

  return null;
}

export async function buildGraph(
  onProgress?: (done: number, total: number) => void
): Promise<GraphData> {
  const pages = await listPages();
  const pathIndex = buildPathIndex(pages);
  const validIds = new Set(pages.map((p) => p.id));

  const nodes: Record<number, GraphNode> = {};
  for (const p of pages) {
    nodes[p.id] = { id: p.id, path: p.path, locale: p.locale, title: p.title };
  }

  const edgesOut: Record<number, number[]> = {};
  const edgesIn: Record<number, number[]> = {};
  let unresolvedLinkCount = 0;
  let edgeCount = 0;
  const sampleUnresolvedPaths = new Set<string>();
  const MAX_SAMPLES = 25;

  const limit = pLimit(config.fetchConcurrency);
  let done = 0;

  await Promise.all(
    pages.map((page) =>
      limit(async () => {
        try {
          const content = await getPageContent(page.id);
          const candidates = content
            ? extractInternalLinkCandidates(content.content, config.wikiBaseUrl)
            : [];

          const targetIds = new Set<number>();
          for (const candidate of candidates) {
            const targetId = resolvePathToId(candidate, pathIndex, validIds);
            if (targetId !== null && targetId !== page.id) {
              targetIds.add(targetId);
            } else if (targetId === null) {
              unresolvedLinkCount++;
              if (sampleUnresolvedPaths.size < MAX_SAMPLES) {
                sampleUnresolvedPaths.add(candidate);
              }
            }
          }

          if (targetIds.size > 0) {
            edgesOut[page.id] = Array.from(targetIds);
            edgeCount += targetIds.size;
            for (const targetId of targetIds) {
              if (!edgesIn[targetId]) edgesIn[targetId] = [];
              edgesIn[targetId].push(page.id);
            }
          }
        } catch (err) {
          // Don't let one bad page kill the whole rebuild -- log and move on.
          console.error(`Failed to fetch/parse page ${page.id} (${page.path}):`, err);
        } finally {
          done++;
          onProgress?.(done, pages.length);
        }
      })
    )
  );

  return {
    builtAt: new Date().toISOString(),
    nodes,
    edgesOut,
    edgesIn,
    stats: {
      pageCount: pages.length,
      edgeCount,
      unresolvedLinkCount,
      sampleUnresolvedPaths: Array.from(sampleUnresolvedPaths),
    },
  };
}

export interface LocalGraphOptions {
  /** Max hops to traverse. Omit/null = no limit -- BFS runs until it
   * naturally runs out of new pages to reach. This is the default: for a
   * normal page with a handful of outgoing links, that just means "show
   * everything downstream of this page" without the caller having to guess
   * a depth. `maxNodes` below is what protects against a handful of true
   * hub pages (e.g. the wiki's intro) blowing this up. */
  depth?: number | null;
  /** Which edges to follow while expanding the BFS frontier. Defaults to
   * "out" -- Hugo (via Jordan) specifically asked for "all outgoing links
   * from the page you're on", not backlinks. Kept configurable in case we
   * want incoming/both again later. */
  direction?: "out" | "in" | "both";
  /** Safety cap on total node count. When hit, BFS stops expanding early
   * and the result comes back with `truncated: true` so the frontend can
   * tell the user to lower the depth manually instead of silently
   * rendering a half-finished, misleading graph. */
  maxNodes?: number;
}

const DEFAULT_MAX_NODES = 150;

function neighborsOf(
  graph: GraphData,
  id: number,
  direction: "out" | "in" | "both"
): number[] {
  switch (direction) {
    case "out":
      return graph.edgesOut[id] ?? [];
    case "in":
      return graph.edgesIn[id] ?? [];
    case "both":
      return [...(graph.edgesOut[id] ?? []), ...(graph.edgesIn[id] ?? [])];
  }
}

/**
 * BFS out from `startId`, by default following only outgoing links (the
 * page's own links out, not who links to it) -- this is the "local graph"
 * view (like Obsidian's), not the whole-wiki graph.
 *
 * The edge list in the result is NOT restricted to `direction`: it includes
 * every edgesOut relationship between any two nodes that ended up in the
 * visited set, regardless of which direction we traversed to reach them.
 * That's deliberate -- if the reachable pages loop back on each other
 * (A -> B -> C -> A), those edges still show up and the result reads as a
 * web/mesh rather than a strict tree, without needing special-case logic
 * for cycles.
 */
export function localGraph(
  graph: GraphData,
  startId: number,
  options: LocalGraphOptions = {}
): {
  nodes: GraphNode[];
  edges: { source: number; target: number }[];
  truncated: boolean;
} {
  if (!graph.nodes[startId]) {
    return { nodes: [], edges: [], truncated: false };
  }

  const { depth = null, direction = "out", maxNodes = DEFAULT_MAX_NODES } = options;

  const visited = new Set<number>([startId]);
  let frontier = [startId];
  let truncated = false;
  let hop = 0;

  while (frontier.length > 0 && (depth === null || hop < depth) && !truncated) {
    const next: number[] = [];
    for (const id of frontier) {
      if (truncated) break;
      for (const n of neighborsOf(graph, id, direction)) {
        if (visited.has(n)) continue;
        if (visited.size >= maxNodes) {
          truncated = true;
          break;
        }
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
    hop++;
  }

  const edgesSeen = new Set<string>();
  const edges: { source: number; target: number }[] = [];
  for (const id of visited) {
    for (const target of graph.edgesOut[id] ?? []) {
      if (!visited.has(target)) continue;
      const key = `${id}->${target}`;
      if (edgesSeen.has(key)) continue;
      edgesSeen.add(key);
      edges.push({ source: id, target });
    }
  }

  const nodes = Array.from(visited)
    .map((id) => graph.nodes[id])
    .filter((n): n is GraphNode => Boolean(n));

  return { nodes, edges, truncated };
}
