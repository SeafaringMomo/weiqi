/**
 * Pure board geometry helpers — no DOM, so they can be unit tested.
 */

export interface Layout {
  size: number;
  /** Canvas CSS pixel size (square). */
  canvasSize: number;
  /** Margin from canvas edge to the first line, in CSS pixels. */
  margin: number;
  /** Distance between adjacent lines, in CSS pixels. */
  spacing: number;
  /** Pixel radius of a stone. */
  stoneRadius: number;
}

/** Column labels in the usual Go order, skipping the letter I. */
export const COLUMN_LABELS = "ABCDEFGHJKLMNOPQRST".split("");

export function columnLabel(x: number): string {
  return COLUMN_LABELS[x] ?? "";
}

/** Row label: y = 0 (top) is the highest number, y = size - 1 (bottom) is 1. */
export function rowLabel(y: number, size: number): string {
  return String(size - y);
}

export function computeLayout(size: number, canvasSize: number): Layout {
  const margin = canvasSize * 0.075;
  const spacing = (canvasSize - margin * 2) / (size - 1);
  return { size, canvasSize, margin, spacing, stoneRadius: spacing * 0.46 };
}

export function pointToXY(layout: Layout, x: number, y: number): { px: number; py: number } {
  return {
    px: layout.margin + x * layout.spacing,
    py: layout.margin + y * layout.spacing,
  };
}

/** Converts a pixel position to the nearest intersection, or null when outside the board. */
export function xyToPoint(layout: Layout, px: number, py: number): { x: number; y: number } | null {
  const x = Math.round((px - layout.margin) / layout.spacing);
  const y = Math.round((py - layout.margin) / layout.spacing);
  if (x < 0 || y < 0 || x >= layout.size || y >= layout.size) return null;
  const { px: cx, py: cy } = pointToXY(layout, x, y);
  const tolerance = layout.spacing * 0.5;
  if (Math.abs(px - cx) > tolerance || Math.abs(py - cy) > tolerance) return null;
  return { x, y };
}

/** Star point coordinates for a given board size. */
export function starPoints(size: number): Array<{ x: number; y: number }> {
  const edge = size >= 19 ? 3 : size >= 13 ? 3 : 2;
  const center = (size - 1) / 2;
  const coords = [edge, size - 1 - edge];
  const points: Array<{ x: number; y: number }> = [];
  for (const x of coords) {
    for (const y of coords) points.push({ x, y });
  }
  points.push({ x: center, y: center });
  // 19x19 has the four extra side stars.
  if (size >= 19) {
    points.push({ x: edge, y: center }, { x: size - 1 - edge, y: center });
    points.push({ x: center, y: edge }, { x: center, y: size - 1 - edge });
  }
  return points;
}
