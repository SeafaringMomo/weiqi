/**
 * Shared domain types for the rules engine. Nothing here imports express, fs,
 * http or config — the engine stays a pure, transport-free module.
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Stone = typeof EMPTY | typeof BLACK | typeof WHITE;
export type Color = "black" | "white";

/** Board is a flat row-major array; index i = y * size + x. 0 = empty, 1 = black, 2 = white. */
export type Board = Int8Array;

export interface Point {
  x: number;
  y: number;
}

export type Phase = "playing" | "scoring" | "ended";

export type ErrorCode =
  | "ILLEGAL_OCCUPIED"
  | "ILLEGAL_SUICIDE"
  | "ILLEGAL_KO"
  | "ILLEGAL_TURN"
  | "WRONG_PHASE"
  | "BAD_REQUEST"
  | "GAME_NOT_FOUND"
  | "NOT_FOUND";

export interface MoveRecord {
  n: number;
  color: Color;
  x?: number;
  y?: number;
  pass?: boolean;
}

export interface Score {
  black: number;
  white: number;
  komi: number;
  result: string;
}

export interface GameState {
  id: string;
  boardSize: number;
  komi: number;
  phase: Phase;
  turn: Color;
  agentColor: Color;
  board: Board;
  captures: { black: number; white: number };
  moves: MoveRecord[];
  lastMove: Point | null;
  deadStones: Point[];
  score: Score | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
  /** Internal: hash of every board position, starting with the empty board. Never exposed by the API. */
  hashHistory: string[];
}

export interface MoveContext {
  hashHistory: string[];
  /** True when the immediately preceding move was a pass (ko check is skipped). */
  lastMoveWasPass: boolean;
}

export type MoveResult =
  | { ok: true; board: Board; captures: number; hash: string }
  | { ok: false; code: ErrorCode };

export function colorToStone(color: Color): Stone {
  return color === "black" ? BLACK : WHITE;
}

export function otherColor(color: Color): Color {
  return color === "black" ? "white" : "black";
}
