import { describe, expect, it } from "vitest";
import { indexOf, initialHashHistory, legalMoves, newBoard, tryMove } from "../src/game/engine.js";
import { computeScore, formatResult, toggleDeadStone } from "../src/game/scoring.js";
import type { Board, Point } from "../src/game/types.js";

const SIZE = 9;

function boardWith(stones: string): Board {
  const board = newBoard(SIZE);
  for (const token of stones.trim().split(/\s+/).filter(Boolean)) {
    const [color, coords] = token.split(":");
    const [xs, ys] = coords!.split(",");
    board[indexOf(SIZE, Number(xs), Number(ys))] = color === "x" ? 1 : 2;
  }
  return board;
}

describe("area scoring", () => {
  it("splits a board with one black and one white territory down the middle", () => {
    // Black occupies column 3, white column 5. Column 4 is dame-ish in the
    // sense that it borders both colours; columns 0-2 are black territory and
    // 6-8 white territory.
    const blackCol = Array.from({ length: 9 }, (_, y) => `x:3,${y}`).join(" ");
    const whiteCol = Array.from({ length: 9 }, (_, y) => `o:5,${y}`).join(" ");
    const board = boardWith(`${blackCol} ${whiteCol}`);
    // Column 4 borders black at x=3 and white at x=5 => neutral.
    const score = computeScore(board, SIZE, [], 0);
    expect(score.black).toBe(9 + 27); // 9 stones + 3 columns of territory
    expect(score.white).toBe(9 + 27);
    expect(score.komi).toBe(0);
    expect(score.result).toBe("Draw");
  });

  it("subtracts komi from black", () => {
    const blackCol = Array.from({ length: 9 }, (_, y) => `x:3,${y}`).join(" ");
    const whiteCol = Array.from({ length: 9 }, (_, y) => `o:6,${y}`).join(" ");
    const board = boardWith(`${blackCol} ${whiteCol}`);
    // x<3 black territory (27), x=3 black stone (9), x=4,5 border white only? x=4
    // borders black at 3, so neutral; x=4 is not adjacent to white (5 empty)
    // Actually x=4 neighbours: 3 (black) and 5 (empty) => white territory.
    const score = computeScore(board, SIZE, [], 3.75);
    // Columns 0-2 are black territory; 4-5 touch both colours (dame); 7-8
    // are white territory.
    expect(score.komi).toBe(3.75);
    expect(score.black).toBe(36); // 9 stones + 27 territory
    expect(score.white).toBe(27); // 9 stones + 18 territory
    expect(score.result).toBe("B+10.5");
  });

  it("counts dead stones as opponent territory", () => {
    // Black stone at (4,4) marked dead inside a white-surrounded region.
    const ring: string[] = [];
    for (let x = 1; x <= 5; x++) ring.push(`o:${x},1`, `o:${x},5`);
    for (let y = 1; y <= 5; y++) ring.push(`o:1,${y}`, `o:5,${y}`);
    const board = boardWith(`${ring.join(" ")} x:4,4`);
    const alive = computeScore(board, SIZE, [], 0);
    // The exterior empty region (56 points) borders white only => white
    // territory. The interior region touches the live black stone as well, so
    // its 8 empty points are neutral while the black stone is alive.
    expect(alive.black).toBe(1);
    expect(alive.white).toBe(16 + 56);

    const dead: Point[] = [{ x: 4, y: 4 }];
    const scored = computeScore(board, SIZE, dead, 0);
    // Once the black stone is dead, the whole interior becomes white too.
    expect(scored.black).toBe(0);
    expect(scored.white).toBe(16 + 56 + 9);
  });

  it("does not award neutral points touching both colours", () => {
    // One black stone and one white stone far apart: all empty points touch
    // both colours only through large regions? Use a small separation instead.
    const board = boardWith("x:4,3 o:4,5");
    const score = computeScore(board, SIZE, [], 0);
    // Empty region is connected and touches both colours => all dame.
    expect(score.black).toBe(1);
    expect(score.white).toBe(1);
  });

  it("formats results with stones doubled into points", () => {
    expect(formatResult(5.25)).toBe("B+10.5");
    expect(formatResult(-5.25)).toBe("W+10.5");
    expect(formatResult(3)).toBe("B+6");
    expect(formatResult(-0.5)).toBe("W+1");
    expect(formatResult(0)).toBe("Draw");
  });

  it("toggles whole connected groups of dead stones", () => {
    const board = boardWith("x:2,2 x:3,2 o:0,0");
    const marked = toggleDeadStone(board, SIZE, [], 2, 2);
    expect(marked.length).toBe(2);
    expect(marked).toContainEqual({ x: 3, y: 2 });
    const unmarked = toggleDeadStone(board, SIZE, marked, 3, 2);
    expect(unmarked).toEqual([]);
    // Toggling an empty point changes nothing.
    expect(toggleDeadStone(board, SIZE, [], 5, 5)).toEqual([]);
  });
});

describe("legal moves", () => {
  it("excludes occupied, suicide and ko points", () => {
    const board = newBoard(SIZE);
    board[indexOf(SIZE, 0, 0)] = 1;
    const points = legalMoves(board, "black", {
      hashHistory: initialHashHistory(SIZE),
      lastMoveWasPass: false,
    });
    expect(points.length).toBe(80);
    expect(points).not.toContainEqual({ x: 0, y: 0 });

    // Suicide point: white stones at (0,1) and (1,0).
    const suicideBoard = boardWith("o:0,1 o:1,0");
    const suicidePoints = legalMoves(suicideBoard, "black", {
      hashHistory: initialHashHistory(SIZE),
      lastMoveWasPass: false,
    });
    // Two white stones are occupied, and (0,0) is suicide => 78 legal points.
    expect(suicidePoints).not.toContainEqual({ x: 0, y: 0 });
    expect(suicidePoints.length).toBe(81 - 2 - 1);
  });

  it("does not mutate the board", () => {
    const board = boardWith("x:4,4");
    const before = Array.from(board);
    legalMoves(board, "white", { hashHistory: initialHashHistory(SIZE), lastMoveWasPass: false });
    tryMove(board, "white", 3, 4, { hashHistory: initialHashHistory(SIZE), lastMoveWasPass: false });
    expect(Array.from(board)).toEqual(before);
  });
});
