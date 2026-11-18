/**
 * Chinese rules area scoring (数子法): dead stones, territory, komi, result string.
 * Pure module — only imports ./types.js and ./engine.js (both transport-free).
 */
import { BLACK, EMPTY, WHITE, type Board, type Point, type Score } from "./types.js";
import { groupOf, neighbors } from "./engine.js";

export function deadSet(size: number, deadStones: Point[]): Set<number> {
  const set = new Set<number>();
  for (const p of deadStones) {
    if (Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < size && p.y < size) {
      set.add(p.y * size + p.x);
    }
  }
  return set;
}

/**
 * Toggles the dead/alive mark for the whole solid group at (x, y).
 * Returns a new deadStones array (empty if no stone there, or not a group toggle).
 */
export function toggleDeadStone(board: Board, size: number, deadStones: Point[], x: number, y: number): Point[] {
  const idx = y * size + x;
  if (board[idx] === EMPTY) return deadStones.map((p) => ({ ...p }));
  const group = groupOf(board, size, idx);
  const current = deadSet(size, deadStones);
  const wasDead = current.has(idx);
  for (const s of group.stones) {
    if (wasDead) current.delete(s);
    else current.add(s);
  }
  const out: Point[] = [];
  for (const i of [...current].sort((a, b) => a - b)) {
    out.push({ x: i % size, y: Math.floor(i / size) });
  }
  return out;
}

/** Formats a score difference (in stones) as a result string such as "B+10.5". */
export function formatResult(diff: number): string {
  const rounded = Math.round(Math.abs(diff) * 2 * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  if (diff > 0) return `B+${text}`;
  if (diff < 0) return `W+${text}`;
  return "Draw";
}

export function computeScore(board: Board, size: number, deadStones: Point[], komi: number): Score {
  const dead = deadSet(size, deadStones);
  const effective = new Uint8Array(board.length); // 0 empty (incl. dead), 1 black, 2 white
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== EMPTY && !dead.has(i)) effective[i] = board[i]!;
  }

  let black = 0;
  let white = 0;
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] === BLACK) black++;
    else if (effective[i] === WHITE) white++;
  }

  // Territory: flood-fill each empty region, look at the colours touching it.
  const visited = new Uint8Array(effective.length);
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] !== EMPTY || visited[i]) continue;
    let blackBorders = false;
    let whiteBorders = false;
    let regionSize = 0;
    const stack = [i];
    visited[i] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      regionSize++;
      for (const n of neighbors(size, cur)) {
        const v = effective[n];
        if (v === EMPTY) {
          if (!visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        } else if (v === BLACK) blackBorders = true;
        else whiteBorders = true;
      }
    }
    if (blackBorders && !whiteBorders) black += regionSize;
    else if (whiteBorders && !blackBorders) white += regionSize;
    // both colours (or neither, impossible on a non-empty board) => dame, no points
  }

  const diff = black - komi - white;
  return { black, white, komi, result: formatResult(diff) };
}
