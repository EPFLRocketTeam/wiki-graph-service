import fs from "fs";
import path from "path";
import { GraphData, buildGraph } from "./graphBuilder";

const DATA_DIR = path.join(__dirname, "..", "data");
const GRAPH_FILE = path.join(DATA_DIR, "graph.json");

let current: GraphData | null = null;
let building = false;
let lastError: string | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadFromDisk(): GraphData | null {
  try {
    if (fs.existsSync(GRAPH_FILE)) {
      const raw = fs.readFileSync(GRAPH_FILE, "utf-8");
      current = JSON.parse(raw) as GraphData;
      console.log(
        `Loaded cached graph from disk (built ${current.builtAt}, ${current.stats.pageCount} pages, ${current.stats.edgeCount} edges)`
      );
    }
  } catch (err) {
    console.error("Failed to load cached graph.json, starting empty:", err);
  }
  return current;
}

function saveToDisk(graph: GraphData) {
  ensureDataDir();
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph), "utf-8");
}

export function getGraph(): GraphData | null {
  return current;
}

export function getStatus() {
  return {
    building,
    lastError,
    builtAt: current?.builtAt ?? null,
    stats: current?.stats ?? null,
  };
}

export async function rebuild(): Promise<GraphData> {
  if (building) {
    throw new Error("A rebuild is already in progress");
  }
  building = true;
  lastError = null;
  const startedAt = Date.now();
  try {
    console.log("Rebuilding wiki link graph...");
    const graph = await buildGraph((done, total) => {
      if (done % 100 === 0 || done === total) {
        console.log(`  fetched ${done}/${total} pages`);
      }
    });
    current = graph;
    saveToDisk(graph);
    console.log(
      `Rebuild done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ` +
        `${graph.stats.pageCount} pages, ${graph.stats.edgeCount} edges, ` +
        `${graph.stats.unresolvedLinkCount} unresolved links.`
    );
    return graph;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error("Graph rebuild failed:", err);
    throw err;
  } finally {
    building = false;
  }
}
