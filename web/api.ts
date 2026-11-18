/** Typed fetch client for the weiqi REST API. */

export type Color = "black" | "white";
export type Phase = "playing" | "scoring" | "ended";

export interface Point {
  x: number;
  y: number;
}

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

export interface Game {
  id: string;
  boardSize: number;
  komi: number;
  phase: Phase;
  turn: Color;
  agentColor: Color;
  board: number[][];
  captures: { black: number; white: number };
  moves: MoveRecord[];
  lastMove: Point | null;
  deadStones: Point[];
  score: Score | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameSummary {
  id: string;
  createdAt: string;
  phase: Phase;
  turn: Color;
  boardSize: number;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new ApiError(data?.code ?? "HTTP_ERROR", data?.error ?? res.statusText, res.status);
  }
  return data as T;
}

export function createGame(opts: { boardSize?: number; agentColor?: Color }): Promise<Game> {
  return request<Game>("POST", "/api/games", opts);
}

export function getGame(id: string): Promise<Game> {
  return request<Game>("GET", `/api/games/${encodeURIComponent(id)}`);
}

export function listGames(): Promise<{ games: GameSummary[] }> {
  return request<{ games: GameSummary[] }>("GET", "/api/games");
}

export function playMove(id: string, color: Color, x: number, y: number): Promise<Game> {
  return request<Game>("POST", `/api/games/${encodeURIComponent(id)}/move`, { color, x, y });
}

export function pass(id: string, color: Color): Promise<Game> {
  return request<Game>("POST", `/api/games/${encodeURIComponent(id)}/pass`, { color });
}

export function resign(id: string, color: Color): Promise<Game> {
  return request<Game>("POST", `/api/games/${encodeURIComponent(id)}/resign`, { color });
}

export function toggleDeadStone(id: string, x: number, y: number): Promise<Game> {
  return request<Game>("POST", `/api/games/${encodeURIComponent(id)}/dead-stone`, { x, y });
}

export function confirmScore(id: string): Promise<Game> {
  return request<Game>("POST", `/api/games/${encodeURIComponent(id)}/confirm-score`, {});
}

/** Fetches the live score preview; the server also returns it on state reads. */
export async function previewScore(id: string): Promise<Score | null> {
  const game = await getGame(id);
  return game.score;
}
