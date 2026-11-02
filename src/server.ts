import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: "0.1.0" });
});

// Static frontend (public/). Built assets land in public/dist via esbuild.
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.listen(config.port, config.host, () => {
  console.log(`weiqi-app listening on http://${config.host}:${config.port}`);
});
