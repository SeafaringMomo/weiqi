# weiqi-app · 围棋 Web 应用

浏览器围棋应用：单进程 Express 服务同时提供 REST API 与静态前端，端口 `1358`。支持浏览器热座对弈，也支持外部 Agent（如 Coder / hermes）通过轮询 REST API 与人对弈。

- 规则：中国规则数子法，含提子、禁自杀、简单劫、虚着、死子标记、确认数子
- 棋盘：9 / 13 / 19 路（默认 19）
- 存储：内存 `Map` + `data/<id>.json` 原子写盘，重启自动恢复
- 无数据库、无前端框架、无 WebSocket、无鉴权

## 架构

```
┌────────────────────────────── 浏览器 ──────────────────────────────┐
│  public/index.html + styles.css                                    │
│  web/main.ts ── api.ts (fetch)     web/board.ts ── Canvas 渲染      │
│        │                                ▲                          │
│        └── 1s 轮询 / 乐观更新 ──────────┘  geometry.ts（纯函数）    │
└───────────────────────────┬────────────────────────────────────────┘
                            │ HTTP (port 1358)
┌───────────────────────────▼────────────────────────────────────────┐
│  Express (src/server.ts)                                           │
│    /api/*  ── routes/games.ts  ── game/store.ts ── data/*.json      │
│                                  │                                 │
│                                  ├── game/engine.ts   （纯函数）    │
│                                  └── game/scoring.ts  （纯函数）    │
│    /*      ── express.static(public/)                              │
└────────────────────────────────────────────────────────────────────┘
                            ▲
              外部 Agent 轮询 REST API（项目内无 agent 代码）
```

`game/engine.ts` 与 `game/scoring.ts` 不依赖 express / fs / config，可独立 import 与单测。

## 安装与启动

需要 Node ≥ 20。

```bash
yarn install
cp .env.example .env       # 按需修改
yarn dev                   # 开发：tsx watch 后端 + esbuild watch 前端
```

生产：

```bash
yarn build                 # tsc(后端) + esbuild(前端) → dist/ 与 public/dist/bundle.js
yarn start                 # node dist/server.js
```

打开 <http://127.0.0.1:1358/>。

测试与类型检查：

```bash
yarn test                  # vitest run（引擎 / 计分 / 几何 / REST 集成）
yarn typecheck             # 后端 tsc --noEmit
yarn typecheck:web         # 前端 tsc --noEmit
```

## 配置（`.env`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `1358` | HTTP 端口，1–65535 |
| `HOST` | `127.0.0.1` | 监听地址。应用无鉴权，默认仅本机；局域网对弈改 `0.0.0.0` 自行评估风险 |
| `DEFAULT_BOARD_SIZE` | `19` | 默认路数，只允许 9 / 13 / 19 |
| `KOMI` | `7.5` | 贴子，单位「子」（中国规则数子法，等价 7.5 目）。9/13/19 路共用该值 |
| `DATA_DIR` | `./data` | 对局 JSON 目录 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

非法值会在启动时抛错退出（fail fast）。代码中不硬编码端口、贴子、路数或数据目录。

## 用浏览器对弈

- **热座模式**：同一浏览器双方轮流点棋盘。建局时选择「我执」，或直接用 `?game=<id>` 打开。
- **单色模式**：URL 追加 `?color=black` 或 `?color=white`，前端只允许操作该色（对手回合时提示等待）。这是纯 UI 约束，服务端不鉴权。
- **数子**：连续两虚着进入 `scoring`，点击棋组标记 / 取消死子，比分实时预览，点「确认数子」终局。任一方确认即生效（先确认者终局）。
- **认输**：二次确认，结果 `B+R` / `W+R`。

## REST API

统一前缀 `/api`，JSON。错误格式 `{ "error": string, "code": string }` + 4xx。

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ok:true,version}` |
| POST | `/api/games` | `{boardSize?, komi?, agentColor?}` | 建局，返回完整状态（201）；`agentColor` 缺省 `white` |
| GET | `/api/games` | — | 最近 50 局摘要，按创建时间倒序 |
| GET | `/api/games/:id` | — | 完整状态 |
| POST | `/api/games/:id/move` | `{color, x, y}` | 落子 |
| POST | `/api/games/:id/pass` | `{color}` | 虚着；连续两虚着进入数子 |
| POST | `/api/games/:id/resign` | `{color}` | 认输 |
| POST | `/api/games/:id/dead-stone` | `{x, y}` | 切换该连通块死活（仅 `scoring`） |
| POST | `/api/games/:id/confirm-score` | `{}` | 固化比分并结束（仅 `scoring`） |
| GET | `/api/games/:id/legal-moves?color=black\|white` | — | `{"points":[[x,y],...]}` |

错误码：`ILLEGAL_OCCUPIED` / `ILLEGAL_SUICIDE` / `ILLEGAL_KO` / `ILLEGAL_TURN` / `WRONG_PHASE` / `BAD_REQUEST` / `GAME_NOT_FOUND` / `NOT_FOUND`。

坐标：`x` 为列（0 起，左→右），`y` 为行（0 起，上→下）。前端显示坐标列为 A–T（跳过 I），行为 19..1（下→上）。

## 如何与 Agent 对弈

项目内**不包含** agent 代码，Agent 通过 API 接入。以下以 Coder 为例：

```bash
# 1. 开一局，Agent 执白（默认）；也可以 {"agentColor":"black"} 让 Agent 先行
curl -s -X POST http://127.0.0.1:1358/api/games \
  -H 'content-type: application/json' -d '{"boardSize":19}'
# => {"id":"g_xxxxxxxxxx", ...}

# 2. 把 id 给用户：浏览器打开
#    http://127.0.0.1:1358/?game=g_xxxxxxxxxx&color=black

# 3. Agent 循环：查询 → 若 turn==agentColor 且 phase=="playing" 则落子
curl -s http://127.0.0.1:1358/api/games/g_xxxxxxxxxx
curl -s -X POST http://127.0.0.1:1358/api/games/g_xxxxxxxxxx/move \
  -H 'content-type: application/json' -d '{"color":"white","x":15,"y":15}'

# 4. 兜底合法点（19 路约 50–150ms，仅供调试）
curl -s 'http://127.0.0.1:1358/api/games/g_xxxxxxxxxx/legal-moves?color=white'

# 5. 双方虚着进入数子后，确认死子 → 确认数子
curl -s -X POST http://127.0.0.1:1358/api/games/g_xxxxxxxxxx/dead-stone \
  -H 'content-type: application/json' -d '{"x":15,"y":15}'
curl -s -X POST http://127.0.0.1:1358/api/games/g_xxxxxxxxxx/confirm-score \
  -H 'content-type: application/json' -d '{}'
```

推荐循环：

```
GET /api/games/:id
  phase == "ended"                            -> 结束
  phase == "scoring"                          -> 检查 score / 调整死子 -> confirm-score
  turn == agentColor && phase == "playing"    -> 选点 -> POST move
     400 ILLEGAL_OCCUPIED/SUICIDE/KO          -> 换点重试
     400 ILLEGAL_TURN                         -> 状态过期，重新查询
     400 WRONG_PHASE                          -> 停止落子
  否则 sleep 2s 重查
```

用户落子无需通知 Agent，前端每秒轮询会自动显示 Agent 的落子。

## 已知局限

- **热座模式**：同一浏览器让对方操作；`?color=` 仅限制 UI，服务端无鉴权。
- **简单劫**：只禁止「一手回提」造成同形，无全局禁同形（superko）。劫争处理跨过 pass 时不判定。
- **无鉴权，默认仅绑定 `127.0.0.1`**：改 `HOST=0.0.0.0` 前请自行评估局域网风险。
- **贴子不区分路数**：9 / 13 / 19 路统一取 `KOMI`。
- **`legal-moves` 性能**：逐点试跑 flood fill，19 路约 50–150ms，期间 Node 单线程会短暂阻塞其他请求；前端不使用该端点，仅供 Agent 兜底与调试。
- **写盘失败语义**：持久化失败只记录错误日志，内存状态已生效、本次请求仍返回成功。极端情况下重启会丢失最后一手。
- **无计时器、无形势判断、无复盘回放、无 WebSocket**：1 秒轮询同步。

## 目录

```
scripts/build-web.mjs   esbuild 打包 web/ → public/dist/bundle.js
scripts/dev.sh          tsx watch + esbuild watch
src/server.ts           Express 装配、静态托管、监听
src/config.ts           .env → 类型化配置
src/game/types.ts       领域类型
src/game/engine.ts      规则引擎（纯函数）
src/game/scoring.ts     数子法计分（纯函数）
src/game/store.ts       GameStore：Map + JSON 持久化
src/routes/games.ts     REST 路由
web/                    前端 TS 源码（main / board / api / geometry）
public/                 静态站点
test/                   vitest 用例
```
