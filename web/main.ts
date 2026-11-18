/**
 * Frontend entry: setup screen, game view, polling, optimistic moves, scoring UI.
 */
import * as api from "./api.js";
import type { Color, Game, Point } from "./api.js";
import { BoardView } from "./board.js";

type El<T extends HTMLElement = HTMLElement> = T;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const ui = {
  setup: el("setup"),
  game: el("game"),
  board: el<HTMLCanvasElement>("board"),
  phase: el("phase"),
  turn: el("turn"),
  scorePanel: el("score-panel"),
  scoreBlack: el("score-black"),
  scoreWhite: el("score-white"),
  scoreKomi: el("score-komi"),
  scoreResult: el("score-result"),
  resultBanner: el("result-banner"),
  capBlack: el("cap-black"),
  capWhite: el("cap-white"),
  msg: el("msg"),
  btnPass: el<HTMLButtonElement>("btn-pass"),
  btnResign: el<HTMLButtonElement>("btn-resign"),
  btnConfirm: el<HTMLButtonElement>("btn-confirm"),
  btnNew: el<HTMLButtonElement>("btn-new"),
  btnCreate: el<HTMLButtonElement>("btn-create"),
  hint: el("hint"),
  gameId: el("game-id"),
  optSize: el<HTMLSelectElement>("opt-size"),
  optColor: el<HTMLSelectElement>("opt-color"),
  recent: el("recent"),
  setupError: el("setup-error"),
};

/** Colour the local player controls, from `?color=`; null = hot seat (both). */
const lockedColor = readColorParam();

let game: Game | null = null;
let view: BoardView | null = null;
let hover: Point | null = null;
/** Moves we expect the server to have after our in-flight optimistic move. */
let pendingSeq = 0;
let optimistic: { x: number; y: number; color: Color } | null = null;
let pollTimer: number | null = null;
let busy = false;

function readColorParam(): Color | null {
  const v = new URLSearchParams(location.search).get("color");
  return v === "black" || v === "white" ? v : null;
}

function gameIdParam(): string | null {
  return new URLSearchParams(location.search).get("game");
}

function showSetup(error?: string): void {
  ui.setup.hidden = false;
  ui.game.hidden = true;
  ui.setupError.hidden = !error;
  if (error) ui.setupError.textContent = error;
  if (lockedColor) {
    ui.optColor.value = lockedColor;
    ui.optColor.disabled = true;
  }
  void renderRecent();
}

async function renderRecent(): Promise<void> {
  try {
    const { games } = await api.listGames();
    if (games.length === 0) {
      ui.recent.replaceChildren();
      return;
    }
    const title = document.createElement("div");
    title.className = "field";
    title.textContent = "最近对局";
    const list = document.createElement("div");
    list.className = "recent";
    for (const g of games.slice(0, 5)) {
      const a = document.createElement("a");
      a.href = `?game=${encodeURIComponent(g.id)}`;
      a.textContent = `${g.id} · ${g.boardSize}路 · ${phaseLabel(g.phase)} · ${new Date(g.createdAt).toLocaleString()}`;
      list.appendChild(a);
    }
    ui.recent.replaceChildren(title, list);
  } catch {
    ui.recent.replaceChildren();
  }
}

function phaseLabel(phase: Game["phase"]): string {
  return phase === "playing" ? "对弈中" : phase === "scoring" ? "数子中" : "已结束";
}

function colorName(c: Color): string {
  return c === "black" ? "黑方" : "白方";
}

/** Whether the local user may act as `color` right now. */
function canControl(color: Color): boolean {
  return lockedColor === null || lockedColor === color;
}

function setMessage(text: string | null, isError = false): void {
  ui.msg.hidden = text === null;
  ui.msg.textContent = text ?? "";
  ui.msg.classList.toggle("error-msg", isError);
}

async function createGame(): Promise<void> {
  const boardSize = Number(ui.optSize.value);
  const myColor = lockedColor ?? (ui.optColor.value as Color);
  ui.btnCreate.disabled = true;
  try {
    const created = await api.createGame({
      boardSize,
      agentColor: myColor === "black" ? "white" : "black",
    });
    const params = new URLSearchParams();
    params.set("game", created.id);
    if (lockedColor) params.set("color", lockedColor);
    history.replaceState(null, "", `?${params.toString()}`);
    await openGame(created);
  } catch (e) {
    showSetup((e as Error).message);
  } finally {
    ui.btnCreate.disabled = false;
  }
}

async function openGame(initial: Game): Promise<void> {
  game = initial;
  optimistic = null;
  pendingSeq = 0;
  ui.setup.hidden = true;
  ui.game.hidden = false;
  ui.gameId.textContent = initial.id;

  if (!view) {
    view = new BoardView(ui.board, initial.boardSize);
  } else {
    view.setSize(initial.boardSize);
  }
  view.resize();
  render();

  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void poll();
  }, 1000);
}

async function poll(): Promise<void> {
  if (!game) return;
  try {
    const fresh = await api.getGame(game.id);
    // Discard stale responses that predate our optimistic move.
    if (optimistic && fresh.moves.length < pendingSeq) return;
    game = fresh;
    optimistic = null;
    render();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 404) {
      stopPolling();
      showSetup("对局不存在或已被删除");
    }
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  game = null;
  optimistic = null;
}

function viewBoard(): number[][] {
  if (!game) return [];
  if (!optimistic) return game.board;
  const copy = game.board.map((row) => row.slice());
  copy[optimistic.y]![optimistic.x] = optimistic.color === "black" ? 1 : 2;
  return copy;
}

function deadMatrix(): boolean[][] {
  if (!game) return [];
  const grid = game.board.map((row) => row.map(() => false));
  for (const p of game.deadStones) {
    const row = grid[p.y];
    if (row) row[p.x] = true;
  }
  return grid;
}

function hoverColor(): 1 | 2 {
  if (!game) return 1;
  const c = lockedColor ?? game.turn;
  return c === "black" ? 1 : 2;
}

function render(): void {
  if (!game || !view) return;
  const board = viewBoard();
  const lastMove = optimistic ? { x: optimistic.x, y: optimistic.y } : game.lastMove;
  view.render({
    board,
    size: game.boardSize,
    lastMove,
    dead: deadMatrix(),
    hover: game.phase === "playing" ? hover : null,
    hoverColor: hoverColor(),
  });

  ui.phase.textContent = phaseLabel(game.phase);
  ui.turn.textContent = turnText(game);
  ui.capBlack.textContent = String(game.captures.black);
  ui.capWhite.textContent = String(game.captures.white);

  // Score panel.
  const score = game.score;
  ui.scorePanel.hidden = score === null;
  if (score) {
    ui.scoreBlack.textContent = String(score.black);
    ui.scoreWhite.textContent = String(score.white);
    ui.scoreKomi.textContent = `${score.komi} 子`;
    ui.scoreResult.textContent =
      game.phase === "scoring"
        ? `黑 ${score.black} − 贴 ${score.komi} = ${round2(score.black - score.komi)}，白 ${score.white}（预览 ${score.result}）`
        : score.result;
  }

  // Result banner.
  if (game.phase === "ended" && game.result) {
    ui.resultBanner.hidden = false;
    ui.resultBanner.textContent = resultText(game.result);
  } else {
    ui.resultBanner.hidden = true;
  }

  ui.btnConfirm.hidden = game.phase !== "scoring";
  ui.btnPass.disabled = !canAct(game.phase === "playing");
  // Resigning is legal in both playing and scoring; the server checks the turn
  // only while the game is in progress.
  ui.btnResign.disabled = !canResign(game);
  ui.btnConfirm.disabled = game.phase !== "scoring";
  ui.hint.textContent = hintText(game);
}

function canResign(g: Game): boolean {
  if (busy || (g.phase !== "playing" && g.phase !== "scoring")) return false;
  if (lockedColor !== null && g.turn !== lockedColor) return false;
  return true;
}

function round2(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

function canAct(allowed: boolean): boolean {
  if (!game || !allowed || busy) return false;
  if (lockedColor !== null && game.turn !== lockedColor) return false;
  return true;
}

function turnText(g: Game): string {
  if (g.phase === "ended") return "对局结束";
  if (g.phase === "scoring") return "数子阶段";
  if (lockedColor !== null) {
    if (g.turn === lockedColor) return "你的回合";
    return `${colorName(g.turn)}行棋（对方）`;
  }
  return `${colorName(g.turn)}行棋`;
}

function hintText(g: Game): string {
  if (g.phase === "scoring") return "点击棋组可标记 / 取消死子，比分实时更新。双方确认任一方即可终局。";
  if (g.phase === "ended") return "本局已结束，点击「新对局」开始下一局。";
  if (lockedColor !== null && g.turn !== lockedColor) {
    return `等待 ${colorName(g.turn)}（Agent）落子……页面每秒自动刷新。`;
  }
  if (lockedColor === null) return "热座模式：双方轮流在同一设备上落子。";
  return "点击交叉点落子。";
}

function resultText(result: string): string {
  if (result === "B+R") return "黑中盘胜";
  if (result === "W+R") return "白中盘胜";
  const m = /^([BW])\+(.+)$/.exec(result);
  if (!m) return result;
  return `${m[1] === "B" ? "黑" : "白"}胜 ${m[2]} 目`;
}

async function onBoardClick(ev: MouseEvent): Promise<void> {
  if (!game || !view || busy) return;
  const point = view.eventToPoint(ev);
  if (!point) return;

  if (game.phase === "scoring") {
    await toggleDead(point);
    return;
  }
  if (game.phase !== "playing") return;

  const color = lockedColor ?? game.turn;
  if (color !== game.turn) {
    setMessage(`等待 ${colorName(game.turn)}落子`, true);
    return;
  }
  if ((game.board[point.y]?.[point.x] ?? 0) !== 0) return;

  // Optimistic update.
  const previous = game;
  optimistic = { ...point, color };
  pendingSeq = game.moves.length + 1;
  busy = true;
  render();

  try {
    const next = await api.playMove(game.id, color, point.x, point.y);
    game = next;
    optimistic = null;
    setMessage(null);
    render();
  } catch (e) {
    game = previous;
    optimistic = null;
    setMessage(moveErrorMessage(e), true);
    render();
  } finally {
    busy = false;
  }
}

function moveErrorMessage(e: unknown): string {
  if (e instanceof api.ApiError) {
    const map: Record<string, string> = {
      ILLEGAL_OCCUPIED: "该点已有棋子",
      ILLEGAL_SUICIDE: "禁着点：自杀",
      ILLEGAL_KO: "打劫：不能立即回提",
      ILLEGAL_TURN: "还没轮到你落子",
      WRONG_PHASE: "当前阶段不能落子",
    };
    return map[e.code] ?? e.message;
  }
  return (e as Error).message;
}

async function toggleDead(point: Point): Promise<void> {
  if (!game) return;
  busy = true;
  try {
    game = await api.toggleDeadStone(game.id, point.x, point.y);
    render();
  } catch (e) {
    setMessage(moveErrorMessage(e), true);
  } finally {
    busy = false;
  }
}

async function doPass(): Promise<void> {
  if (!game || busy) return;
  const color = lockedColor ?? game.turn;
  if (color !== game.turn) {
    setMessage(`等待 ${colorName(game.turn)}`, true);
    return;
  }
  busy = true;
  try {
    game = await api.pass(game.id, color);
    setMessage(null);
    render();
  } catch (e) {
    setMessage(moveErrorMessage(e), true);
  } finally {
    busy = false;
  }
}

async function doResign(): Promise<void> {
  if (!game || busy) return;
  const color = lockedColor ?? game.turn;
  if (!window.confirm("确定认输吗？")) return;
  busy = true;
  try {
    game = await api.resign(game.id, color);
    setMessage(null);
    render();
  } catch (e) {
    setMessage(moveErrorMessage(e), true);
  } finally {
    busy = false;
  }
}

async function doConfirm(): Promise<void> {
  if (!game || busy) return;
  if (!window.confirm("确认当前死子标记并结束对局？")) return;
  busy = true;
  try {
    game = await api.confirmScore(game.id);
    setMessage(null);
    render();
  } catch (e) {
    setMessage(moveErrorMessage(e), true);
  } finally {
    busy = false;
  }
}

function newGame(): void {
  stopPolling();
  history.replaceState(null, "", location.pathname + (lockedColor ? `?color=${lockedColor}` : ""));
  view = null;
  showSetup();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

ui.btnCreate.addEventListener("click", () => void createGame());
ui.btnNew.addEventListener("click", newGame);
ui.btnPass.addEventListener("click", () => void doPass());
ui.btnResign.addEventListener("click", () => void doResign());
ui.btnConfirm.addEventListener("click", () => void doConfirm());
ui.board.addEventListener("click", (ev) => void onBoardClick(ev));
ui.board.addEventListener("mousemove", (ev) => {
  if (!view || !game) return;
  const p = view.eventToPoint(ev);
  if ((p?.x ?? -1) !== (hover?.x ?? -1) || (p?.y ?? -1) !== (hover?.y ?? -1)) {
    hover = p;
    render();
  }
});
ui.board.addEventListener("mouseleave", () => {
  hover = null;
  render();
});
window.addEventListener("resize", () => {
  if (view) {
    view.resize();
    render();
  }
});

async function boot(): Promise<void> {
  const id = gameIdParam();
  if (!id) {
    showSetup();
    return;
  }
  ui.setup.hidden = true;
  try {
    const loaded = await api.getGame(id);
    await openGame(loaded);
  } catch (e) {
    showSetup(e instanceof api.ApiError && e.status === 404 ? "对局不存在" : (e as Error).message);
  }
}

void boot();
