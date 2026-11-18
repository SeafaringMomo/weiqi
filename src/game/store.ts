/**
 * GameStore: in-memory Map of games + JSON file persistence (atomic tmp+rename).
 * Loading is best-effort: unreadable files are logged and skipped.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  initialHashHistory,
  indexOf,
  inBounds,
  isValidBoardSize,
  lastMoveWasPass,
  legalMoves,
  newBoard,
  trailingPasses,
  tryMove,
} from "./engine.js";
import { computeScore, toggleDeadStone } from "./scoring.js";
import {
  type Board,
  type Color,
  type ErrorCode,
  type GameState,
  type Point,
  type Score,
  otherColor,
} from "./types.js";

export interface CreateGameOptions {
  boardSize: number;
  komi: number;
  agentColor: Color;
}

export type Err = { ok: false; code: ErrorCode; message: string };
export type Ok<T> = { ok: true; value: T };
export type Result<T> = Ok<T> | Err;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

function err(code: ErrorCode, message: string): Err {
  return { ok: false, code, message };
}

export function isValidColor(value: unknown): value is Color {
  return value === "black" || value === "white";
}

export interface SerializedGame
  extends Omit<GameState, "board" | "lastMove" | "deadStones" | "score"> {
  board: number[][];
  lastMove: Point | null;
  deadStones: Point[];
  score: Score | null;
}

/** Public API shape: `board` becomes rows, internal `hashHistory` is stripped. */
export interface PublicGame extends Omit<GameState, "board" | "hashHistory"> {
  board: number[][];
}

function now(): string {
  return new Date().toISOString();
}

function boardToRows(board: Board, size: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < size; y++) {
    rows.push(Array.from(board.slice(y * size, y * size + size)));
  }
  return rows;
}

function rowsToBoard(rows: number[][]): Board {
  const size = rows.length;
  const board = newBoard(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) board[indexOf(size, x, y)] = rows[y]![x] ?? 0;
  }
  return board;
}

export function newGameId(): string {
  return "g_" + crypto.randomBytes(5).toString("hex");
}

/** Score is a live preview while scoring, frozen once ended via confirm. */
export function scoreFor(state: GameState): Score | null {
  if (state.phase === "scoring") {
    return computeScore(state.board, state.boardSize, state.deadStones, state.komi);
  }
  return state.score;
}

export function toPublic(state: GameState): PublicGame {
  const { hashHistory: _hidden, board, ...rest } = state;
  return { ...rest, board: boardToRows(board, state.boardSize) };
}

export class GameStore {
  private games = new Map<string, GameState>();

  constructor(private readonly dataDir: string) {
    this.loadAll();
  }

  // -- persistence ---------------------------------------------------------

  private filePath(id: string): string {
    return path.join(this.dataDir, `${id}.json`);
  }

  private loadAll(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dataDir);
    } catch {
      return; // directory doesn't exist yet — created lazily on first save
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dataDir, name), "utf8")) as SerializedGame;
        const state = this.deserialize(raw);
        this.games.set(state.id, state);
      } catch (e) {
        console.error(`[store] failed to load ${name}:`, (e as Error).message);
      }
    }
  }

  private deserialize(raw: SerializedGame): GameState {
    const size = raw.boardSize;
    return {
      id: raw.id,
      boardSize: size,
      komi: raw.komi,
      phase: raw.phase,
      turn: raw.turn,
      agentColor: raw.agentColor,
      board: rowsToBoard(raw.board),
      captures: raw.captures ?? { black: 0, white: 0 },
      moves: raw.moves ?? [],
      lastMove: raw.lastMove ?? null,
      deadStones: raw.deadStones ?? [],
      score: raw.score ?? null,
      result: raw.result ?? null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      hashHistory:
        Array.isArray(raw.hashHistory) && raw.hashHistory.length > 0
          ? raw.hashHistory
          : initialHashHistory(size),
    };
  }

  private serialize(state: GameState): SerializedGame {
    const { board, ...rest } = state;
    return { ...rest, board: boardToRows(board, state.boardSize) };
  }

  private save(state: GameState): void {
    const file = this.filePath(state.id);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.serialize(state)), "utf8");
      fs.renameSync(tmp, file);
    } catch (e) {
      // Memory state stays authoritative for this process; documented trade-off.
      console.error(`[store] failed to persist ${state.id}:`, (e as Error).message);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // -- queries -------------------------------------------------------------

  get(id: string): GameState | undefined {
    return this.games.get(id);
  }

  list(limit: number): GameState[] {
    return [...this.games.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  // -- commands ------------------------------------------------------------

  create(opts: CreateGameOptions): Result<GameState> {
    if (!isValidBoardSize(opts.boardSize)) return err("BAD_REQUEST", `invalid boardSize: ${opts.boardSize}`);
    if (!Number.isFinite(opts.komi) || opts.komi < 0) return err("BAD_REQUEST", "invalid komi");
    if (!isValidColor(opts.agentColor)) return err("BAD_REQUEST", "invalid agentColor");

    const timestamp = now();
    const state: GameState = {
      id: newGameId(),
      boardSize: opts.boardSize,
      komi: opts.komi,
      phase: "playing",
      turn: "black",
      agentColor: opts.agentColor,
      board: newBoard(opts.boardSize),
      captures: { black: 0, white: 0 },
      moves: [],
      lastMove: null,
      deadStones: [],
      score: null,
      result: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      hashHistory: initialHashHistory(opts.boardSize),
    };
    this.games.set(state.id, state);
    this.save(state);
    return ok(state);
  }

  private guardTurn(state: GameState, color: Color): Err | null {
    if (state.phase !== "playing") return err("WRONG_PHASE", `game phase is ${state.phase}`);
    if (color !== state.turn) return err("ILLEGAL_TURN", `it is ${state.turn}'s turn`);
    return null;
  }

  move(id: string, color: Color, x: number, y: number): Result<GameState> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    const turnErr = this.guardTurn(state, color);
    if (turnErr) return turnErr;
    if (!inBounds(state.boardSize, x, y)) return err("BAD_REQUEST", `point (${x},${y}) out of bounds`);

    const res = tryMove(state.board, color, x, y, {
      hashHistory: state.hashHistory,
      lastMoveWasPass: lastMoveWasPass(state.moves),
    });
    if (!res.ok) return err(res.code, res.code);

    state.board = res.board;
    state.hashHistory.push(res.hash);
    if (color === "black") state.captures.black += res.captures;
    else state.captures.white += res.captures;
    state.moves.push({ n: state.moves.length + 1, color, x, y });
    state.lastMove = { x, y };
    state.turn = otherColor(color);
    state.updatedAt = now();
    this.save(state);
    return ok(state);
  }

  pass(id: string, color: Color): Result<GameState> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    const turnErr = this.guardTurn(state, color);
    if (turnErr) return turnErr;

    state.moves.push({ n: state.moves.length + 1, color, pass: true });
    state.turn = otherColor(color);
    if (trailingPasses(state.moves) >= 2) {
      state.phase = "scoring";
      state.deadStones = [];
    }
    state.updatedAt = now();
    this.save(state);
    return ok(state);
  }

  resign(id: string, color: Color): Result<GameState> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    if (state.phase === "ended") return err("WRONG_PHASE", "game already ended");
    if (color !== state.turn) return err("ILLEGAL_TURN", `it is ${state.turn}'s turn`);
    state.phase = "ended";
    state.result = color === "black" ? "W+R" : "B+R";
    state.score = null;
    state.updatedAt = now();
    this.save(state);
    return ok(state);
  }

  toggleDead(id: string, x: number, y: number): Result<GameState> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    if (state.phase !== "scoring") return err("WRONG_PHASE", `game phase is ${state.phase}`);
    if (!inBounds(state.boardSize, x, y)) return err("BAD_REQUEST", `point (${x},${y}) out of bounds`);
    state.deadStones = toggleDeadStone(state.board, state.boardSize, state.deadStones, x, y);
    state.updatedAt = now();
    this.save(state);
    return ok(state);
  }

  confirmScore(id: string): Result<GameState> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    if (state.phase !== "scoring") return err("WRONG_PHASE", `game phase is ${state.phase}`);
    state.score = computeScore(state.board, state.boardSize, state.deadStones, state.komi);
    state.result = state.score.result;
    state.phase = "ended";
    state.updatedAt = now();
    this.save(state);
    return ok(state);
  }

  legalMoves(id: string, color: Color): Result<Point[]> {
    const state = this.games.get(id);
    if (!state) return err("GAME_NOT_FOUND", `game ${id} not found`);
    if (!isValidColor(color)) return err("BAD_REQUEST", "invalid color");
    return ok(
      legalMoves(state.board, color, {
        hashHistory: state.hashHistory,
        lastMoveWasPass: lastMoveWasPass(state.moves),
      }),
    );
  }
}
