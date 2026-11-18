/**
 * Canvas board renderer.
 */
import {
  COLUMN_LABELS,
  computeLayout,
  pointToXY,
  rowLabel,
  starPoints,
  xyToPoint,
  type Layout,
} from "./geometry.js";

export interface RenderOptions {
  board: number[][];
  size: number;
  lastMove: { x: number; y: number } | null;
  dead: boolean[][];
  hover: { x: number; y: number } | null;
  hoverColor: 1 | 2;
}

const COLORS = {
  wood: "#e3b271",
  woodDark: "#d9a662",
  line: "#4a3418",
  blackStone: "#111111",
  whiteStone: "#f7f7f2",
  deadMark: "#e0483b",
  label: "#3d2a13",
};

export class BoardView {
  private layout: Layout;
  private dpr: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private size: number,
  ) {
    this.layout = computeLayout(size, this.cssSize());
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  private cssSize(): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(240, Math.min(rect.width || 560, 720));
  }

  resize(): void {
    const css = this.cssSize();
    this.layout = computeLayout(this.size, css);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(css * this.dpr);
    this.canvas.height = Math.round(css * this.dpr);
    this.canvas.style.height = `${css}px`;
  }

  setSize(size: number): void {
    this.size = size;
    this.resize();
  }

  /** Maps a pointer event (client coords) to a board point. */
  eventToPoint(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    return xyToPoint(this.layout, ev.clientX - rect.left, ev.clientY - rect.top);
  }

  render(opts: RenderOptions): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { layout } = this;
    this.size = opts.size;
    if (layout.size !== opts.size || layout.canvasSize !== this.cssSize()) {
      this.resize();
    }
    const L = this.layout;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, L.canvasSize, L.canvasSize);

    // Wood background.
    const grad = ctx.createLinearGradient(0, 0, L.canvasSize, L.canvasSize);
    grad.addColorStop(0, COLORS.wood);
    grad.addColorStop(1, COLORS.woodDark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, L.canvasSize, L.canvasSize);

    this.drawGrid(ctx);
    this.drawLabels(ctx);
    this.drawStars(ctx);
    this.drawStones(ctx, opts);
    this.drawHover(ctx, opts);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const L = this.layout;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(1, L.spacing * 0.035);
    ctx.beginPath();
    for (let i = 0; i < L.size; i++) {
      const { px } = pointToXY(L, i, 0);
      const { py } = pointToXY(L, 0, i);
      ctx.moveTo(px, L.margin);
      ctx.lineTo(px, L.canvasSize - L.margin);
      ctx.moveTo(L.margin, py);
      ctx.lineTo(L.canvasSize - L.margin, py);
    }
    ctx.stroke();
  }

  private drawLabels(ctx: CanvasRenderingContext2D): void {
    const L = this.layout;
    ctx.fillStyle = COLORS.label;
    ctx.font = `${Math.max(10, L.spacing * 0.38)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const offset = L.margin * 0.5;
    for (let i = 0; i < L.size; i++) {
      const { px, py } = pointToXY(L, i, i);
      ctx.fillText(COLUMN_LABELS[i] ?? "", px, L.margin - offset);
      ctx.fillText(COLUMN_LABELS[i] ?? "", px, L.canvasSize - L.margin + offset);
      ctx.fillText(rowLabel(i, L.size), L.margin - offset, py);
      ctx.fillText(rowLabel(i, L.size), L.canvasSize - L.margin + offset, py);
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    const L = this.layout;
    ctx.fillStyle = COLORS.line;
    for (const p of starPoints(L.size)) {
      const { px, py } = pointToXY(L, p.x, p.y);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, L.spacing * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStones(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
    const L = this.layout;
    const r = L.stoneRadius;
    for (let y = 0; y < opts.size; y++) {
      for (let x = 0; x < opts.size; x++) {
        const v = opts.board[y]?.[x] ?? 0;
        if (v === 0) continue;
        const { px, py } = pointToXY(L, x, y);
        const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
        if (v === 1) {
          g.addColorStop(0, "#6a6a6a");
          g.addColorStop(1, COLORS.blackStone);
        } else {
          g.addColorStop(0, "#ffffff");
          g.addColorStop(1, "#c9c9c2");
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (opts.dead[y]?.[x]) {
          ctx.strokeStyle = COLORS.deadMark;
          ctx.lineWidth = Math.max(1.5, r * 0.22);
          ctx.beginPath();
          const d = r * 0.55;
          ctx.moveTo(px - d, py - d);
          ctx.lineTo(px + d, py + d);
          ctx.moveTo(px + d, py - d);
          ctx.lineTo(px - d, py + d);
          ctx.stroke();
        }
      }
    }

    if (opts.lastMove) {
      const { px, py } = pointToXY(L, opts.lastMove.x, opts.lastMove.y);
      const v = opts.board[opts.lastMove.y]?.[opts.lastMove.x] ?? 0;
      ctx.strokeStyle = v === 1 ? "#f2f2f2" : "#111111";
      ctx.lineWidth = Math.max(1.5, r * 0.16);
      ctx.beginPath();
      ctx.arc(px, py, r * 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawHover(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
    if (!opts.hover) return;
    const L = this.layout;
    const { px, py } = pointToXY(L, opts.hover.x, opts.hover.y);
    if ((opts.board[opts.hover.y]?.[opts.hover.x] ?? 0) !== 0) return;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = opts.hoverColor === 1 ? COLORS.blackStone : COLORS.whiteStone;
    ctx.beginPath();
    ctx.arc(px, py, L.stoneRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
