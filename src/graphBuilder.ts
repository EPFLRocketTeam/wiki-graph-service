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

/**
 * BFS out from `startId` over the union of outgoing + incoming edges, up to
 * `depth` hops -- this is the "local graph" view (like Obsidian's), not the
 * whole-wiki graph.
 */
export function localGraph(
  graph: GraphData,
  startId: number,
  depth: number
): { nodes: GraphNode[]; edges: { source: number; target: number }[] } {
  if (!graph.nodes[startId]) {
    return { nodes: [], edges: [] };
  }

  const visited = new Set<number>([startId]);
  let frontier = [startId];

  for (let hop = 0; hop < depth; hop++) {
    const next: number[] = [];
    for (const id of frontier) {
      const neighbors = [
        ...(graph.edgesOut[id] ?? []),
        ...(graph.edgesIn[id] ?? []),
      ];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
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

  return { nodes, edges };
}
