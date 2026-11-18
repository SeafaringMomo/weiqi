import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import {
  GameStore,
  isValidColor,
  scoreFor,
  toPublic,
  type Result,
} from "../game/store.js";
import type { Color, ErrorCode, GameState } from "../game/types.js";

const LIST_LIMIT = 50;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  ILLEGAL_OCCUPIED: 400,
  ILLEGAL_SUICIDE: 400,
  ILLEGAL_KO: 400,
  ILLEGAL_TURN: 400,
  WRONG_PHASE: 400,
  GAME_NOT_FOUND: 404,
  NOT_FOUND: 404,
};

function fail(res: Response, code: ErrorCode, message: string): void {
  res.status(STATUS_BY_CODE[code] ?? 400).json({ error: message, code });
}

/** Sends the public view of a game, with a live score preview during scoring. */
function sendGame(res: Response, state: GameState, status = 200): void {
  res.status(status).json({ ...toPublic(state), score: scoreFor(state) });
}

function unwrap<T>(res: Response, result: Result<T>, onOk: (value: T) => void): void {
  if (result.ok) onOk(result.value);
  else fail(res, result.code, result.message);
}

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function parseCoordinate(value: unknown, size: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value >= size) return null;
  return value;
}

export function createGamesRouter(store: GameStore): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, version: "0.1.0" });
  });

  router.post("/games", (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const boardSize = body.boardSize === undefined ? config.defaultBoardSize : body.boardSize;
    const komi = body.komi === undefined ? config.komi : body.komi;
    const agentColor = body.agentColor === undefined ? "white" : body.agentColor;

    if (typeof boardSize !== "number" || !Number.isInteger(boardSize)) {
      return fail(res, "BAD_REQUEST", "boardSize must be an integer");
    }
    if (typeof komi !== "number" || !Number.isFinite(komi) || komi < 0) {
      return fail(res, "BAD_REQUEST", "komi must be a non-negative number");
    }
    if (!isValidColor(agentColor)) {
      return fail(res, "BAD_REQUEST", 'agentColor must be "black" or "white"');
    }

    unwrap(res, store.create({ boardSize, komi, agentColor }), (state) => sendGame(res, state, 201));
  });

  router.get("/games", (_req, res) => {
    res.json({
      games: store.list(LIST_LIMIT).map((g) => ({
        id: g.id,
        createdAt: g.createdAt,
        phase: g.phase,
        turn: g.turn,
        boardSize: g.boardSize,
      })),
    });
  });

  router.get("/games/:id", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    sendGame(res, state);
  });

  router.post("/games/:id/move", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    const body = isPlainObject(req.body) ? req.body : {};
    const color = body.color as Color;
    if (!isValidColor(color)) return fail(res, "BAD_REQUEST", 'color must be "black" or "white"');
    const x = parseCoordinate(body.x, state.boardSize);
    const y = parseCoordinate(body.y, state.boardSize);
    if (x === null || y === null) {
      return fail(res, "BAD_REQUEST", `x and y must be integers in [0, ${state.boardSize})`);
    }

    unwrap(res, store.move(state.id, color, x, y), (next) => sendGame(res, next));
  });

  router.post("/games/:id/pass", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    const body = isPlainObject(req.body) ? req.body : {};
    const color = body.color as Color;
    if (!isValidColor(color)) return fail(res, "BAD_REQUEST", 'color must be "black" or "white"');
    unwrap(res, store.pass(state.id, color), (next) => sendGame(res, next));
  });

  router.post("/games/:id/resign", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    const body = isPlainObject(req.body) ? req.body : {};
    const color = body.color as Color;
    if (!isValidColor(color)) return fail(res, "BAD_REQUEST", 'color must be "black" or "white"');
    if (state.phase === "ended") return fail(res, "WRONG_PHASE", "game already ended");
    unwrap(res, store.resign(state.id, color), (next) => sendGame(res, next));
  });

  router.post("/games/:id/dead-stone", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    const body = isPlainObject(req.body) ? req.body : {};
    const x = parseCoordinate(body.x, state.boardSize);
    const y = parseCoordinate(body.y, state.boardSize);
    if (x === null || y === null) {
      return fail(res, "BAD_REQUEST", `x and y must be integers in [0, ${state.boardSize})`);
    }
    unwrap(res, store.toggleDead(state.id, x, y), (next) => sendGame(res, next));
  });

  router.post("/games/:id/confirm-score", (req, res) => {
    unwrap(res, store.confirmScore(req.params.id), (next) => sendGame(res, next));
  });

  router.get("/games/:id/legal-moves", (req, res) => {
    const state = store.get(req.params.id);
    if (!state) return fail(res, "GAME_NOT_FOUND", `game ${req.params.id} not found`);
    const color = req.query.color;
    if (!isValidColor(color)) {
      return fail(res, "BAD_REQUEST", 'query parameter color must be "black" or "white"');
    }
    unwrap(res, store.legalMoves(state.id, color), (points) => {
      res.json({ points: points.map((p) => [p.x, p.y]) });
    });
  });

  return router;
}

/** 404 for unknown /api routes. */
export function apiNotFound(req: Request, res: Response): void {
  fail(res, "NOT_FOUND", `no route for ${req.method} ${req.originalUrl}`);
}
