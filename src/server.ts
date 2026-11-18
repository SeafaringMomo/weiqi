import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { GameStore } from "./game/store.js";
import { apiNotFound, createGamesRouter } from "./routes/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(store: GameStore): express.Express {
  const app = express();

  app.use(express.json({ limit: "100kb" }));
  // Malformed JSON bodies surface as SyntaxError from express.json.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid JSON body", code: "BAD_REQUEST" });
      return;
    }
    next(err);
  });

  app.use("/api", createGamesRouter(store));
  app.use("/api", apiNotFound);

  // Static frontend (public/). Built assets land in public/dist via esbuild.
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found", code: "NOT_FOUND" });
  });

  return app;
}

export function start(): void {
  const store = new GameStore(config.dataDir);
  const app = createApp(store);
  app.listen(config.port, config.host, () => {
    console.log(`weiqi-app listening on http://${config.host}:${config.port}`);
  });
}

// Only listen when executed directly (tests import createApp instead).
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  start();
}
