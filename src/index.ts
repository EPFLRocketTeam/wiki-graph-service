import express from "express";
import cors from "cors";
import cron from "node-cron";
import { config } from "./config";
import { router } from "./api";
import { loadFromDisk, rebuild, getGraph } from "./graphStore";

async function main() {
  loadFromDisk();

  const app = express();
  const allowedOrigin = config.allowedOrigin || config.wikiBaseUrl;
  app.use(
    cors({
      origin: allowedOrigin,
    })
  );
  console.log(`CORS restricted to origin: ${allowedOrigin}`);
  app.use("/api", router);

  app.listen(config.port, () => {
    console.log(`wiki-graph-service listening on :${config.port}`);
  });

  // Kick off an initial build in the background if we don't already have a
  // cached graph from a previous run (e.g. first boot on a fresh deploy).
  if (!getGraph()) {
    rebuild().catch(() => {});
  }

  cron.schedule(config.rebuildCron, () => {
    rebuild().catch(() => {});
  });
  console.log(`Scheduled rebuilds: "${config.rebuildCron}"`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
