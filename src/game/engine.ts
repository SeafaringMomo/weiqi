/**
 * Pure Go rules engine: placement, capture, suicide, simple ko, pass, legal moves.
 * No I/O, no config, no transport — only ./types.js.
 */
import {
  BLACK,
  EMPTY,
  WHITE,
  type Board,
  type Color,
  type MoveContext,
  type MoveRecord,
  type MoveResult,
  type Point,
  type Stone,
  colorToStone,
} from "./types.js";

export const ALLOWED_BOARD_SIZES = [9, 13, 19] as const;

export function isValidBoardSize(size: number): boolean {
  return (ALLOWED_BOARD_SIZES as readonly number[]).includes(size);
}

export function newBoard(size: number): Board {
  return new Int8Array(size * size);
}

export function cloneBoard(board: Board): Board {
  return Int8Array.from(board);
}

export function indexOf(size: number, x: number, y: number): number {
  return y * size + x;
}

export function pointOf(size: number, index: number): Point {
  return { x: index % size, y: Math.floor(index / size) };
}

export function inBounds(size: number, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;
}

export function neighbors(size: number, index: number): number[] {
  const x = index % size;
  const y = Math.floor(index / size);
  const out: number[] = [];
  if (x > 0) out.push(index - 1);
  if (x < size - 1) out.push(index + 1);
  if (y > 0) out.push(index - size);
  if (y < size - 1) out.push(index + size);
  return out;
}

/** Flood-fills the solid group of same-coloured stones containing `index`. */
export function groupOf(board: Board, size: number, index: number): { stones: number[]; liberties: number } {
  const color = board[index];
  const stones: number[] = [];
  if (color === EMPTY) return { stones, liberties: 0 };
  const seen = new Uint8Array(board.length);
  const libs = new Set<number>();
  const stack = [index];
  seen[index] = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    stones.push(cur);
    for (const n of neighbors(size, cur)) {
      if (board[n] === EMPTY) libs.add(n);
      else if (board[n] === color && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return { stones, liberties: libs.size };
}

export function countStones(board: Board, color: Stone): number {
  let n = 0;
  for (let i = 0; i < board.length; i++) if (board[i] === color) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Zobrist hashing. A fixed PRNG seed keeps hashes stable across restarts so
// persisted hashHistory stays meaningful after the server reloads a game.
// ---------------------------------------------------------------------------

const MAX_POINTS = 19 * 19;

function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

const rand = xorshift32(0x9e3779b9);
const ZOBRIST_LO: number[] = [];
const ZOBRIST_HI: number[] = [];
for (let i = 0; i < MAX_POINTS; i++) {
  for (let c = 0; c < 2; c++) {
    ZOBRIST_LO.push(rand());
    ZOBRIST_HI.push(rand());
  }
}

/** Position hash: depends only on the board, not on turn/komi/captures. 16 hex chars. */
export function boardHash(board: Board): string {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c === EMPTY) continue;
    const slot = i * 2 + (c === BLACK ? 0 : 1);
    lo = (lo ^ ZOBRIST_LO[slot]) >>> 0;
    hi = (hi ^ ZOBRIST_HI[slot]) >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/** Initial history for a fresh game: the empty-board position. */
export function initialHashHistory(size: number): string[] {
  return [boardHash(newBoard(size))];
}

// ---------------------------------------------------------------------------
// Move legality
// ---------------------------------------------------------------------------

/**
 * Tries to play `color` at (x, y) on a copy of `board`.
 * Suicide is only legal when it captures something ("capturing suicide").
 * Simple ko: the resulting position may not equal the position two plies ago.
 */
export function tryMove(
  board: Board,
  color: Color,
  x: number,
  y: number,
  ctx: MoveContext,
): MoveResult {
  const size = Math.sqrt(board.length);
  if (!Number.isInteger(size) || !inBounds(size, x, y)) {
    return { ok: false, code: "BAD_REQUEST" };
  }
  const idx = indexOf(size, x, y);
  if (board[idx] !== EMPTY) return { ok: false, code: "ILLEGAL_OCCUPIED" };

  const me = colorToStone(color);
  const opp = me === BLACK ? WHITE : BLACK;
  const next = cloneBoard(board);
  next[idx] = me;

  // Capture adjacent opponent groups with no liberties.
  let captures = 0;
  const handled = new Uint8Array(next.length);
  for (const n of neighbors(size, idx)) {
    if (next[n] !== opp || handled[n]) continue;
    const group = groupOf(next, size, n);
    for (const s of group.stones) handled[s] = 1;
    if (group.liberties === 0) {
      for (const s of group.stones) next[s] = EMPTY;
      captures += group.stones.length;
    }
  }

  // Suicide check (after captures).
  if (captures === 0) {
    const own = groupOf(next, size, idx);
    if (own.liberties === 0) return { ok: false, code: "ILLEGAL_SUICIDE" };
  }

  const hash = boardHash(next);

  // Simple ko: recreate the position from two plies ago => immediate recapture.
  const h = ctx.hashHistory;
  if (!ctx.lastMoveWasPass && h.length >= 2 && hash === h[h.length - 2]) {
    return { ok: false, code: "ILLEGAL_KO" };
  }

  return { ok: true, board: next, captures, hash };
}

/** Every legal placement for `color`, in reading order. */
export function legalMoves(board: Board, color: Color, ctx: MoveContext): Point[] {
  const size = Math.sqrt(board.length);
  const out: Point[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== EMPTY) continue;
    const p = pointOf(size, i);
    if (tryMove(board, color, p.x, p.y, ctx).ok) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bookkeeping helpers shared by the store / routes
// ---------------------------------------------------------------------------

export function nextMoveNumber(moves: MoveRecord[]): number {
  return moves.length + 1;
}

export function lastMoveWasPass(moves: MoveRecord[]): boolean {
  const last = moves[moves.length - 1];
  return last !== undefined && last.pass === true;
}

/** Number of consecutive passes at the tail of the move list. */
export function trailingPasses(moves: MoveRecord[]): number {
  let n = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i]!.pass) n++;
    else break;
  }
  return n;
}
