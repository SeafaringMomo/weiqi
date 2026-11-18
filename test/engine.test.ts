import { describe, expect, it } from "vitest";
import {
  boardHash,
  countStones,
  groupOf,
  indexOf,
  initialHashHistory,
  inBounds,
  neighbors,
  newBoard,
  tryMove,
} from "../src/game/engine.js";
import type { Board, Color, MoveContext } from "../src/game/types.js";

const SIZE = 9;

function emptyCtx(): MoveContext {
  return { hashHistory: initialHashHistory(SIZE), lastMoveWasPass: false };
}

/**
 * Builds a 9x9 board from a list of placements. Every unlisted point is empty.
 * 'x' = black, 'o' = white.
 */
function boardWith(stones: string): Board {
  const board = newBoard(SIZE);
  for (const token of stones.trim().split(/\s+/).filter(Boolean)) {
    const [color, coords] = token.split(":");
    const [xs, ys] = coords!.split(",");
    board[indexOf(SIZE, Number(xs), Number(ys))] = color === "x" ? 1 : 2;
  }
  return board;
}

function play(board: Board, color: Color, x: number, y: number, ctx: MoveContext = emptyCtx()) {
  const res = tryMove(board, color, x, y, ctx);
  if (!res.ok) throw new Error(`unexpected illegal move ${color} ${x},${y}: ${res.code}`);
  return res;
}

const at = (board: Board, x: number, y: number) => board[indexOf(SIZE, x, y)];

describe("board basics", () => {
  it("creates an empty board", () => {
    const b = newBoard(SIZE);
    expect(b.length).toBe(81);
    expect(countStones(b, 1)).toBe(0);
    expect(countStones(b, 2)).toBe(0);
  });

  it("computes neighbours with correct borders", () => {
    expect(neighbors(SIZE, indexOf(SIZE, 0, 0)).sort()).toEqual(
      [indexOf(SIZE, 1, 0), indexOf(SIZE, 0, 1)].sort(),
    );
    expect(neighbors(SIZE, indexOf(SIZE, 4, 4)).length).toBe(4);
    expect(neighbors(SIZE, indexOf(SIZE, 8, 0)).length).toBe(2);
  });

  it("checks bounds", () => {
    expect(inBounds(SIZE, 8, 8)).toBe(true);
    expect(inBounds(SIZE, 9, 0)).toBe(false);
    expect(inBounds(SIZE, -1, 0)).toBe(false);
    expect(inBounds(SIZE, 1.5, 0)).toBe(false);
  });

  it("hashes boards deterministically and distinctly", () => {
    const a = newBoard(SIZE);
    const b = newBoard(SIZE);
    expect(boardHash(a)).toBe(boardHash(b));
    expect(boardHash(a)).toMatch(/^[0-9a-f]{16}$/);
    b[indexOf(SIZE, 2, 2)] = 1;
    expect(boardHash(a)).not.toBe(boardHash(b));
    const c = newBoard(SIZE);
    c[indexOf(SIZE, 2, 2)] = 2;
    expect(boardHash(c)).not.toBe(boardHash(b));
  });
});

describe("capture", () => {
  it("captures a single stone with the last liberty", () => {
    // White at (2,1) with black on three sides; black fills (3,1).
    const board = boardWith("x:1,1 x:2,0 x:2,2 o:2,1");
    const res = play(board, "black", 3, 1);
    expect(res.captures).toBe(1);
    expect(at(res.board, 2, 1)).toBe(0);
    expect(countStones(res.board, 2)).toBe(0);
  });

  it("captures a multi-stone group as a whole", () => {
    // White group (2,1)+(2,2) has a single liberty left at (2,3).
    const board = boardWith("o:2,1 o:2,2 x:1,1 x:3,1 x:1,2 x:3,2 x:2,0");
    const res = play(board, "black", 2, 3);
    expect(res.captures).toBe(2);
    expect(countStones(res.board, 2)).toBe(0);
    expect(at(res.board, 2, 2)).toBe(0);
  });

  it("captures two separate groups with a single move", () => {
    // White at (1,1) and (3,1); black plays (2,1), the shared last liberty.
    const board = boardWith("o:1,1 o:3,1 x:0,1 x:1,0 x:1,2 x:3,0 x:3,2 x:4,1 x:2,0 x:2,2");
    const res = play(board, "black", 2, 1);
    expect(res.captures).toBe(2);
    expect(at(res.board, 1, 1)).toBe(0);
    expect(at(res.board, 3, 1)).toBe(0);
    expect(at(res.board, 2, 1)).toBe(1);
  });

  it("rejects an occupied point", () => {
    const b = play(newBoard(SIZE), "black", 0, 0).board;
    const res = tryMove(b, "white", 0, 0, emptyCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ILLEGAL_OCCUPIED");
  });
});

describe("suicide", () => {
  it("rejects suicide without capture", () => {
    const b = boardWith("o:0,1 o:1,0");
    const res = tryMove(b, "black", 0, 0, emptyCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ILLEGAL_SUICIDE");
  });

  it("allows capturing suicide (a move that would otherwise be suicide)", () => {
    // Four white stones each reduced to their last liberty at (1,1); black
    // playing (1,1) captures all four, which makes the move legal.
    const b = boardWith(
      "o:1,0 o:1,2 o:0,1 o:2,1 x:0,0 x:0,2 x:2,0 x:2,2 x:1,3 x:3,1",
    );
    const res = tryMove(b, "black", 1, 1, emptyCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.captures).toBe(4);
      expect(countStones(res.board, 2)).toBe(0);
      expect(at(res.board, 1, 1)).toBe(1);
    }
  });
});

// Classic ko:
//   . B W .
//   B W . W
//   . B W .
// Black plays (2,1), capturing the white stone at (1,1). The capturing stone
// then has exactly one liberty at (1,1), so a white recapture there would
// restore the previous board position exactly.
const KO_STONES = "x:1,0 x:0,1 x:1,2 o:2,0 o:1,1 o:3,1 o:2,2";

describe("ko", () => {
  it("forbids immediate recapture", () => {
    const board = boardWith(KO_STONES);
    const ctx: MoveContext = {
      hashHistory: [initialHashHistory(SIZE)[0]!, boardHash(board)],
      lastMoveWasPass: false,
    };
    const capture = play(board, "black", 2, 1, ctx);
    expect(capture.captures).toBe(1);
    ctx.hashHistory.push(capture.hash);

    const recapture = tryMove(capture.board, "white", 1, 1, ctx);
    expect(recapture.ok).toBe(false);
    if (!recapture.ok) expect(recapture.code).toBe("ILLEGAL_KO");
  });

  it("skips the ko check when the previous move was a pass", () => {
    const board = boardWith(KO_STONES);
    const ctx: MoveContext = {
      hashHistory: [initialHashHistory(SIZE)[0]!, boardHash(board)],
      lastMoveWasPass: false,
    };
    const capture = play(board, "black", 2, 1, ctx);
    ctx.hashHistory.push(capture.hash);

    const afterPass: MoveContext = { hashHistory: [...ctx.hashHistory], lastMoveWasPass: true };
    expect(tryMove(capture.board, "white", 1, 1, afterPass).ok).toBe(true);
  });

  it("allows the recapture after intervening moves elsewhere", () => {
    const board = boardWith(KO_STONES);
    const ctx: MoveContext = {
      hashHistory: [initialHashHistory(SIZE)[0]!, boardHash(board)],
      lastMoveWasPass: false,
    };
    const capture = play(board, "black", 2, 1, ctx);
    ctx.hashHistory.push(capture.hash);
    const w88 = play(capture.board, "white", 8, 8, ctx);
    ctx.hashHistory.push(w88.hash);
    const b08 = play(w88.board, "black", 0, 8, ctx);
    ctx.hashHistory.push(b08.hash);

    const recapture = tryMove(b08.board, "white", 1, 1, ctx);
    expect(recapture.ok).toBe(true);
    if (recapture.ok) expect(recapture.captures).toBe(1);
  });
});

describe("groups and liberties", () => {
  it("counts liberties of a group", () => {
    const b = boardWith("x:0,0 x:1,0");
    const g = groupOf(b, SIZE, indexOf(SIZE, 1, 0));
    expect(g.stones.length).toBe(2);
    expect(g.liberties).toBe(3);
  });
});
