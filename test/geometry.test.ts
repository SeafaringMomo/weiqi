import { describe, expect, it } from "vitest";
import {
  COLUMN_LABELS,
  columnLabel,
  computeLayout,
  pointToXY,
  rowLabel,
  starPoints,
  xyToPoint,
} from "../web/geometry.js";

describe("board geometry", () => {
  it("maps columns to letters, skipping I", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(7)).toBe("H");
    expect(columnLabel(8)).toBe("J");
    expect(columnLabel(18)).toBe("T");
    expect(COLUMN_LABELS.length).toBe(19);
    expect(COLUMN_LABELS).not.toContain("I");
  });

  it("numbers rows bottom-up", () => {
    expect(rowLabel(0, 19)).toBe("19");
    expect(rowLabel(18, 19)).toBe("1");
    expect(rowLabel(0, 9)).toBe("9");
    expect(rowLabel(8, 9)).toBe("1");
  });

  it("lays points out evenly inside the margin", () => {
    const layout = computeLayout(19, 600);
    expect(pointToXY(layout, 0, 0).px).toBe(layout.margin);
    const last = pointToXY(layout, 18, 18);
    expect(last.px).toBeCloseTo(600 - layout.margin, 6);
    expect(last.py).toBeCloseTo(600 - layout.margin, 6);
    expect(layout.stoneRadius).toBeLessThan(layout.spacing / 2);
  });

  it("round-trips pixel positions to intersections", () => {
    const layout = computeLayout(19, 600);
    expect(xyToPoint(layout, ...Object.values(pointToXY(layout, 4, 15)) as [number, number])).toEqual({
      x: 4,
      y: 15,
    });
    // Slightly off-centre still snaps to the nearest intersection.
    const { px, py } = pointToXY(layout, 4, 15);
    expect(xyToPoint(layout, px + 3, py - 3)).toEqual({ x: 4, y: 15 });
    // Outside the board.
    expect(xyToPoint(layout, -50, -50)).toBeNull();
    expect(xyToPoint(layout, 1000, 1000)).toBeNull();
  });

  it("uses the conventional star points per board size", () => {
    expect(starPoints(19).length).toBe(9);
    expect(starPoints(13).length).toBe(5);
    expect(starPoints(9).length).toBe(5);
    expect(starPoints(9)).toContainEqual({ x: 4, y: 4 });
    expect(starPoints(9)).toContainEqual({ x: 2, y: 2 });
    expect(starPoints(9)).toContainEqual({ x: 6, y: 2 });
    expect(starPoints(19)).toContainEqual({ x: 9, y: 3 });
  });
});
