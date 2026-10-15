import { Router } from "express";
import { config } from "./config";
import { getGraph, getStatus, rebuild } from "./graphStore";
import { localGraph } from "./graphBuilder";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, ...getStatus() });
});

// GET /api/graph/:pageId?depth=&direction=&maxNodes=
// Returns the "local graph" around one page: that page plus everything
// reachable from it via its own outgoing links (by default -- see
// `direction`).
//
// - depth: max hops to traverse. Omit it to let the BFS run until it
//   naturally runs out of new pages -- the right default for a normal page,
//   so the frontend doesn't have to guess a depth up front. Pass an integer
//   to cap it manually (e.g. the frontend's depth slider, for a hub page
//   that would otherwise return a huge/truncated graph).
// - direction: "out" (default, what Hugo asked for), "in", or "both".
// - maxNodes: safety cap on node count (default 150) so a hub page can't
//   return a near-whole-wiki blob; the response comes back with
//   `truncated: true` if the cap was hit, so the frontend can prompt the
//   user to lower depth instead of rendering a misleadingly partial graph.
router.get("/graph/:pageId", (req, res) => {
  const pageId = Number(req.params.pageId);
  if (!Number.isInteger(pageId)) {
    return res.status(400).json({ error: "pageId must be an integer" });
  }

  const graph = getGraph();
  if (!graph) {
    return res.status(503).json({ error: "Graph has not been built yet" });
  }

  let depth: number | null = null;
  if (req.query.depth !== undefined) {
    const parsed = Number(req.query.depth);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return res
        .status(400)
        .json({ error: "depth must be an integer between 1 and 50, or omitted for unlimited" });
    }
    depth = parsed;
  }

  const directionParam = req.query.direction;
  const direction: "out" | "in" | "both" =
    directionParam === "in" || directionParam === "both" ? directionParam : "out";

  let maxNodes = config.defaultMaxGraphNodes;
  if (req.query.maxNodes !== undefined) {
    const parsed = Number(req.query.maxNodes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return res.status(400).json({ error: "maxNodes must be an integer between 1 and 1000" });
    }
    maxNodes = parsed;
  }

  const result = localGraph(graph, pageId, { depth, direction, maxNodes });
  res.json({
    builtAt: graph.builtAt,
    center: pageId,
    depth,
    direction,
    maxNodes,
    ...result,
  });
});

// Full graph dump -- mainly for debugging / a possible future "whole wiki"
// view. Could get large; fine for ~1900 pages, revisit if the wiki grows a lot.
router.get("/graph", (_req, res) => {
  const graph = getGraph();
  if (!graph) {
    return res.status(503).json({ error: "Graph has not been built yet" });
  }
  res.json(graph);
});

// Manual/on-demand rebuild trigger, e.g. for a future Wiki.js webhook on
// page save, or just for us to poke during testing. Requires the shared
// secret from .env as an `x-rebuild-secret` header.
router.post("/rebuild", (req, res) => {
  if (!config.rebuildSecret || req.header("x-rebuild-secret") !== config.rebuildSecret) {
    return res.status(401).json({ error: "Invalid or missing x-rebuild-secret header" });
  }

  rebuild().catch(() => {
    /* already logged inside rebuild() */
  });

  res.status(202).json({ started: true });
});
