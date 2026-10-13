import { Router } from "express";
import { config } from "./config";
import { getGraph, getStatus, rebuild } from "./graphStore";
import { localGraph } from "./graphBuilder";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, ...getStatus() });
});

// GET /api/graph/:pageId?depth=1
// Returns the "local graph" around one page: that page plus everything
// reachable within `depth` hops via outgoing or incoming (backlink) edges.
router.get("/graph/:pageId", (req, res) => {
  const pageId = Number(req.params.pageId);
  if (!Number.isInteger(pageId)) {
    return res.status(400).json({ error: "pageId must be an integer" });
  }

  const graph = getGraph();
  if (!graph) {
    return res.status(503).json({ error: "Graph has not been built yet" });
  }

  const depthParam = req.query.depth;
  const depth = depthParam ? Number(depthParam) : config.defaultGraphDepth;
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
    return res.status(400).json({ error: "depth must be an integer between 1 and 5" });
  }

  const result = localGraph(graph, pageId, depth);
  res.json({
    builtAt: graph.builtAt,
    center: pageId,
    depth,
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
