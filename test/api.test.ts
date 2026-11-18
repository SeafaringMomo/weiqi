import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { GameStore } from "../src/game/store.js";
import { createApp } from "../src/server.js";

let server: Server;
let base: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weiqi-test-"));
  const app = createApp(new GameStore(dataDir));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("REST API", () => {
  it("reports health", async () => {
    const { status, body } = await api("GET", "/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("plays a full game: 5 alternating moves, turn checks, passes, dead stones, confirm", async () => {
    const created = await api("POST", "/games", { boardSize: 9 });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    expect(id).toMatch(/^g_[0-9a-f]+$/);
    expect(created.body.boardSize).toBe(9);
    expect(created.body.phase).toBe("playing");
    expect(created.body.turn).toBe("black");
    expect(created.body.board.length).toBe(9);
    expect(created.body.board[0].length).toBe(9);
    expect(created.body.score).toBeNull();
    expect("hashHistory" in created.body).toBe(false);

    const moves: Array<[number, number]> = [
      [2, 2],
      [6, 6],
      [3, 2],
      [6, 7],
      [4, 2],
    ];
    let state: any;
    for (let i = 0; i < moves.length; i++) {
      const color = i % 2 === 0 ? "black" : "white";
      const [x, y] = moves[i]!;
      const r = await api("POST", `/games/${id}/move`, { color, x, y });
      expect(r.status).toBe(200);
      state = r.body;
      expect(state.moves.length).toBe(i + 1);
      expect(state.board[y][x]).toBe(color === "black" ? 1 : 2);
    }
    expect(state.turn).toBe("white");
    expect(state.lastMove).toEqual({ x: 4, y: 2 });

    const wrongTurn = await api("POST", `/games/${id}/move`, { color: "black", x: 0, y: 0 });
    expect(wrongTurn.status).toBe(400);
    expect(wrongTurn.body.code).toBe("ILLEGAL_TURN");

    const occupied = await api("POST", `/games/${id}/move`, { color: "white", x: 2, y: 2 });
    expect(occupied.status).toBe(400);
    expect(occupied.body.code).toBe("ILLEGAL_OCCUPIED");

    const outOfBounds = await api("POST", `/games/${id}/move`, { color: "white", x: 9, y: 0 });
    expect(outOfBounds.status).toBe(400);
    expect(outOfBounds.body.code).toBe("BAD_REQUEST");

    const badColor = await api("POST", `/games/${id}/move`, { color: "red", x: 0, y: 0 });
    expect(badColor.status).toBe(400);
    expect(badColor.body.code).toBe("BAD_REQUEST");

    const list = await api("GET", "/games");
    expect(list.body.games.some((g: any) => g.id === id)).toBe(true);

    const fetched = await api("GET", `/games/${id}`);
    expect(fetched.body.moves.length).toBe(5);

    // One pass keeps playing; a second pass enters scoring.
    const pass1 = await api("POST", `/games/${id}/pass`, { color: "white" });
    expect(pass1.body.phase).toBe("playing");
    expect(pass1.body.turn).toBe("black");
    const moveAfterPass = await api("POST", `/games/${id}/move`, { color: "black", x: 7, y: 2 });
    expect(moveAfterPass.status).toBe(200);
    expect(moveAfterPass.body.moves.at(-1)).toMatchObject({ color: "black", x: 7, y: 2 });

    const pass2 = await api("POST", `/games/${id}/pass`, { color: "white" });
    expect(pass2.body.phase).toBe("playing");
    const pass3 = await api("POST", `/games/${id}/pass`, { color: "black" });
    expect(pass3.body.phase).toBe("scoring");
    expect(pass3.body.score).not.toBeNull();
    expect(typeof pass3.body.score.result).toBe("string");
    expect(pass3.body.result).toBeNull();

    const moveInScoring = await api("POST", `/games/${id}/move`, { color: "white", x: 0, y: 0 });
    expect(moveInScoring.status).toBe(400);
    expect(moveInScoring.body.code).toBe("WRONG_PHASE");

    const dead = await api("POST", `/games/${id}/dead-stone`, { x: 6, y: 6 });
    expect(dead.status).toBe(200);
    expect(dead.body.deadStones).toContainEqual({ x: 6, y: 6 });
    const unseen = await api("POST", `/games/${id}/dead-stone`, { x: 6, y: 6 });
    expect(unseen.body.deadStones).not.toContainEqual({ x: 6, y: 6 });

    const confirmed = await api("POST", `/games/${id}/confirm-score`, {});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.phase).toBe("ended");
    expect(typeof confirmed.body.result).toBe("string");
    expect(confirmed.body.score).not.toBeNull();

    const afterEnd = await api("POST", `/games/${id}/pass`, { color: "white" });
    expect(afterEnd.body.code).toBe("WRONG_PHASE");
    const deadAfterEnd = await api("POST", `/games/${id}/dead-stone`, { x: 6, y: 7 });
    expect(deadAfterEnd.body.code).toBe("WRONG_PHASE");
  });

  it("supports resignation", async () => {
    const created = await api("POST", "/games", { boardSize: 9, agentColor: "black" });
    const id = created.body.id;
    expect(created.body.agentColor).toBe("black");
    const wrongTurn = await api("POST", `/games/${id}/resign`, { color: "white" });
    expect(wrongTurn.status).toBe(400);
    expect(wrongTurn.body.code).toBe("ILLEGAL_TURN");
    const r = await api("POST", `/games/${id}/resign`, { color: "black" });
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe("ended");
    expect(r.body.result).toBe("W+R");
    expect(r.body.score).toBeNull();
    const again = await api("POST", `/games/${id}/resign`, { color: "white" });
    expect(again.body.code).toBe("WRONG_PHASE");
  });

  it("lists legal moves", async () => {
    const created = await api("POST", "/games", { boardSize: 9 });
    const id = created.body.id;
    await api("POST", `/games/${id}/move`, { color: "black", x: 4, y: 4 });
    const r = await api("GET", `/games/${id}/legal-moves?color=white`);
    expect(r.status).toBe(200);
    expect(r.body.points.length).toBe(80);
    expect(r.body.points).not.toContainEqual([4, 4]);
    const bad = await api("GET", `/games/${id}/legal-moves?color=purple`);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for unknown games and routes", async () => {
    expect((await api("GET", "/games/g_missing")).body.code).toBe("GAME_NOT_FOUND");
    expect((await api("POST", "/games/g_missing/move", { color: "black", x: 0, y: 0 })).status).toBe(404);
    expect((await api("GET", "/nope")).body.code).toBe("NOT_FOUND");
  });

  it("rejects malformed JSON", async () => {
    const res = await fetch(`${base}/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("rejects invalid board sizes and komi", async () => {
    expect((await api("POST", "/games", { boardSize: 10 })).status).toBe(400);
    expect((await api("POST", "/games", { komi: -1 })).status).toBe(400);
    expect((await api("POST", "/games", { agentColor: "green" })).status).toBe(400);
  });
});

describe("persistence", () => {
  it("restores games from disk in a fresh store", async () => {
    const created = await api("POST", "/games", { boardSize: 13 });
    const id = created.body.id;
    await api("POST", `/games/${id}/move`, { color: "black", x: 3, y: 3 });

    const reloaded = new GameStore(dataDir);
    const state = reloaded.get(id);
    expect(state).toBeDefined();
    expect(state!.boardSize).toBe(13);
    expect(state!.board[3 * 13 + 3]).toBe(1);
    expect(state!.moves.length).toBe(1);
    expect(state!.hashHistory.length).toBe(2);
    expect(state!.phase).toBe("playing");
  });
});
