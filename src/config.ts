import path from "node:path";

/**
 * Loads `.env` once at module init. Missing file is fine — defaults below apply
 * (documented in .env.example). All runtime constants MUST come from here.
 */
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to defaults
}

function intFromEnv(
  name: string,
  fallback: number,
  validate: (n: number) => boolean,
  expected: string,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || !validate(n)) {
    throw new Error(`Invalid ${name}=${raw}: expected ${expected}`);
  }
  return n;
}

function floatFromEnv(
  name: string,
  fallback: number,
  validate: (n: number) => boolean,
  expected: string,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !validate(n)) {
    throw new Error(`Invalid ${name}=${raw}: expected ${expected}`);
  }
  return n;
}

const ALLOWED_BOARD_SIZES = [9, 13, 19];

export const config = Object.freeze({
  port: intFromEnv("PORT", 1358, (n) => n >= 1 && n <= 65535, "integer in [1, 65535]"),
  host: process.env.HOST?.trim() || "127.0.0.1",
  defaultBoardSize: intFromEnv(
    "DEFAULT_BOARD_SIZE",
    19,
    (n) => ALLOWED_BOARD_SIZES.includes(n),
    `one of ${ALLOWED_BOARD_SIZES.join(", ")}`,
  ),
  komi: floatFromEnv("KOMI", 7.5, (n) => n >= 0 && n <= 100, "number in [0, 100]"),
  dataDir: path.resolve(process.env.DATA_DIR?.trim() || "./data"),
  logLevel: (["debug", "info", "warn", "error"] as const).includes(
    process.env.LOG_LEVEL?.trim() as never,
  )
    ? (process.env.LOG_LEVEL!.trim() as "debug" | "info" | "warn" | "error")
    : "info",
});

export type Config = typeof config;
