# 围棋 Web 应用（weiqi-app）实施方案

逐段实施项目；每个里程碑结束须验证（单测/构建/curl），不通过则带着错误信息重跑该段。

**Goal**：在 `~/code/weiqi-app` 新建 TypeScript 全栈围棋应用 —— 浏览器对弈界面 + REST API，端口 1358，`.env` 管理配置。hermes agent 可通过 API 作为对手与用户对弈，也可两个用户在同一浏览器对弈。

**Architecture**：单 Express 服务同时托管 API 与静态前端（一个端口）；规则引擎为纯函数 TS 模块（与传输层解耦，重点单测）；对局状态存内存 Map + JSON 文件持久化（重启不丢局）；前端原生 TS + Canvas 渲染，无框架；Agent 通过轮询 REST API 接入对局。

**Tech Stack**：Node 26 + TypeScript 5、Express 5（唯一运行时依赖）、tsx（开发热载）、esbuild（前端打包）、vitest（测试）。无数据库、无前端框架、无 WebSocket、无 dotenv（用 Node 原生 `process.loadEnvFile()`）。

---

## 1. 需求与范围

**功能**
- 9 / 13 / 19 路棋盘，创建对局时可选，默认 19 路
- 完整规则：中国规则数子法（见 §4），含提子、禁自杀、简单劫、虚着、死子标记、确认数子
- REST API：建局、查状态、落子/虚着/认输、合法点查询、死子标记、确认数子
- Agent 接入：Coder 通过 API 与用户对弈（轮询状态 → 决策 → 落子）
- 对局 JSON 文件持久化（`data/` 目录，重启自动恢复）
- 双人对弈：**热座模式**（同一浏览器轮流操作）；URL 带 `?color=black|white` 时前端限制只能操作该色（纯 UI 约束，服务端不鉴权）

**非目标（YAGNI）**：账号体系/鉴权、内置 AI agent（agent 通过外部 API 接入，项目内无 agent 代码）、对局回放 UI、**计时器/计时功能**、WebSocket 实时推送、形势判断/复盘、全局禁同形（superko）。

> 注：功能与规则解耦，可自行选择是否启用某功能/规则。

## 2. 目录结构
weiqi-app/
├── .env # 实际配置（gitignore）
├── .env.example # 配置模板（入库）
├── .gitignore
├── package.json
├── tsconfig.json
├── AGENT.md # 给 AI 编码 Agent 的执行指南
├── SPEC.md # 本文件
├── README.md
├── scripts/
│ ├── build-web.mjs # esbuild 打包 web/ → public/dist/bundle.js
│ └── dev.sh # tsx watch + esbuild watch 并行开发
├── data/ # 对局持久化（gitignore）
├── src/ # 后端 TS
│ ├── server.ts # 入口：express 装配、静态托管、监听 PORT/HOST
│ ├── config.ts # loadEnvFile 读取 .env → 类型化配置对象（默认值 + 校验）
│ ├── game/
│ │ ├── types.ts # Color / Point / Board / MoveRecord / GameState / Phase / ErrorCode
│ │ ├── engine.ts # 规则引擎：落子、提子、禁着点、劫、虚着、合法点
│ │ ├── scoring.ts # 数子法计分（死子标记、领地划分、贴子、结果字符串）
│ │ └── store.ts # GameStore：Map + JSON 文件原子读写（tmp+rename）
│ └── routes/
│ └── games.ts # REST 路由
├── web/ # 前端 TS 源码
│ ├── main.ts # 装配、轮询、交互状态机
│ ├── board.ts # Canvas 渲染（网格/星位/棋子/最后一手/坐标/hover）
│ └── api.ts # 类型化 fetch 客户端
└── public/ # express.static 静态站点
├── index.html
├── styles.css
└── dist/bundle.js # esbuild 产物（gitignore）

text

## 3. `.env` 规范

```ini
# 服务
PORT=1358
HOST=127.0.0.1
# 围棋
DEFAULT_BOARD_SIZE=19
KOMI=3.75          # 单位：子（中国规则数子法贴子；等价 7.5 目）
# 存储
DATA_DIR=./data
LOG_LEVEL=info
config.ts：try { process.loadEnvFile() } catch {}（.env 缺失时回退默认值），导出 Object.freeze 的类型化配置对象。校验：PORT ∈ [1,65535]、HOST 非空字符串、DEFAULT_BOARD_SIZE ∈ {9,13,19}、KOMI ≥ 0；非法值启动即 throw 并退出（fail fast）。

所有常量只允许来自 config：代码中不得出现硬编码端口 / 贴子 / 棋盘尺寸 / 数据目录（测试 fixture 与 .env.example 除外）。

HOST 默认 127.0.0.1：应用无鉴权，默认仅本机可访问；需局域网对弈时用户自行改 0.0.0.0。

KOMI 统一取 .env 值，不区分路数（9/13/19 路同一贴子值），README 注明。

4. 围棋引擎规格（核心算法）
4.1 表示
Board = Int8Array(size*size)，索引 i = y*size + x；值 0=空 1=黑 2=白；坐标 (x,y)，y=0 为顶部行。

局面哈希用 Zobrist：每点每色一个 64 位随机数（两个 Uint32 拼成，输出 16 进制字符串）。哈希只由盘面决定，不含轮走方、不含 komi、不含提子数。

GameState 保存 hashHistory: string[]：仅在非 pass 落子成功后 push 新盘面哈希；pass 不 push。完整历史保留（为未来 superko 留口，但当前只做简单劫）。

4.2 落子 tryMove(board, color, x, y, hashHistory) -> {ok:true, ...} | {ok:false, code}
目标点非空 → ILLEGAL_OCCUPIED

落子后 flood fill 检查相邻对方连通块的气，气为 0 的块整块提掉（更新 captures）

无提子且己方所在块无气 → 自杀 → ILLEGAL_SUICIDE；有提子则允许（"带提子的自杀形"合法）

简单劫判定：若 moves 最后一条不是 pass，且新盘面哈希 == hashHistory[length-2]（即两手前的盘面）→ ILLEGAL_KO。若 hashHistory.length < 2 或最后一条是 pass，跳过此检查。

通过 → 新哈希 push 进 hashHistory，更新 lastMove、captures、turn

错误码枚举（types.ts 定义）：ILLEGAL_OCCUPIED / ILLEGAL_SUICIDE / ILLEGAL_KO / ILLEGAL_TURN / WRONG_PHASE / BAD_REQUEST / GAME_NOT_FOUND / NOT_FOUND（通用）。

4.3 终局与计分（中国规则数子法）
连续两 pass → phase=scoring（单方 pass 切换 turn；一方 pass 后另一方落子，pass 计数清零）。

scoring 阶段：POST dead-stone {x,y} 切换该连通块 dead/alive；死子按空点处理。

领地划分：对每个空点区域 flood fill，若区域边界只接触一色（死子视为空）→ 该色领地；接触双色 → 公气（dame），不计分。

点数：

blackPoints = 黑活子数 + 黑领地（黑领地包含死白子所占点）

whitePoints = 白活子数 + 白领地（含死黑子所占点）

二者之和 = boardSize² − 公气数

结果：diff = (blackPoints − komi) − whitePoints（单位：子）。

diff > 0 → 黑胜，result = "B+" + (diff*2)（子数 ×2 报目；若为整数去小数，否则保留一位小数，如 B+10.5）

diff < 0 → 白胜，result = "W+" + (|diff|*2)

diff === 0 在 komi=3.75 下不会出现（点数整数，3.75 非整数），无需特殊处理

认输：POST resign → phase=ended，result = "B+R"（白认输）或 "W+R"（黑认输），score=null。

确认：POST confirm-score（仅 scoring）→ 计算并固化 score，phase=ended。任一方确认即生效（先确认者终局，README 注明）。

4.4 score 对象结构（scoring 与 ended 阶段返回；playing 阶段为 null）
json
{
  "black": 185,
  "white": 176,
  "komi": 3.75,
  "result": "B+10.5"
}
black / white：原始总点数（整数，含活子 + 领地，死子已按对方领地计）

komi：当前贴子（来自 state）

result：胜负字符串；scoring 阶段为实时预览，ended 阶段为固化值

前端展示时自行计算「黑 X 点 − 贴 3.75 子 = 黑 Y 点」，或直接展示 result

4.5 合法点 legalMoves(board, color, hashHistory)
逐空点试跑 tryMove，返回通过点列表 [[x,y],...]。19 路最坏 361 次 flood fill，实测约 50–150ms（Node 单线程会短暂阻塞其他请求）。此端点仅供 Agent 兜底与调试，前端不使用；README 注明性能限制。不做缓存（YAGNI）。

5. REST API 契约
统一前缀 /api，JSON；错误统一 { "error": string, "code": string } + 4xx。无鉴权（仅绑定 127.0.0.1）。

方法	路径	请求体	说明
GET	/api/health	—	{ok:true, version}
POST	/api/games	{boardSize?, komi?, agentColor?}	建局；boardSize 缺省取 config，komi 缺省取 config，agentColor 缺省 "white"；返回完整状态
GET	/api/games	—	对局列表（id、createdAt、phase、turn、boardSize），默认返回最近 50 条，按 createdAt 倒序
GET	/api/games/:id	—	完整状态
POST	/api/games/:id/move	{color, x, y}	→ 新状态；非法着 400 + code
POST	/api/games/:id/pass	{color}	切换 turn；连续两 pass → scoring
POST	/api/games/:id/resign	{color}	→ ended，result 为对方 +R
POST	/api/games/:id/dead-stone	{x, y}	切换该连通块死活（仅 scoring）
POST	/api/games/:id/confirm-score	{}	→ 计算并固化，ended（仅 scoring）
GET	/api/games/:id/legal-moves?color=black|white	—	{"points": [[x,y],...]}
5.1 服务端校验（必须实现）
:id 不存在 → 404 GAME_NOT_FOUND

move / pass / resign：请求体 color 必须存在且 ∈ {"black","white"} → 否则 400 BAD_REQUEST；color !== state.turn → 400 ILLEGAL_TURN

move / pass / resign：phase !== "playing" → 400 WRONG_PHASE（resign 例外：scoring 阶段也允许 resign，phase ∈ {"playing","scoring"}；ended 阶段拒绝）

move：x,y 必须是 [0, boardSize) 内整数 → 否则 400 BAD_REQUEST；再交引擎判定

dead-stone / confirm-score：phase !== "scoring" → 400 WRONG_PHASE

legal-moves：color 缺失或非法 → 400 BAD_REQUEST

请求体非法 JSON → 400 BAD_REQUEST

5.2 状态对象（各端点返回同一形状）
json
{
  "id": "g_x7f2a1b",
  "boardSize": 19,
  "komi": 3.75,
  "phase": "playing | scoring | ended",
  "turn": "black | white",
  "agentColor": "white",
  "board": [[0,1,0, ...], ...],
  "captures": {"black": 0, "white": 2},
  "moves": [
    {"n":1,"color":"black","x":3,"y":4},
    {"n":2,"color":"white","pass":true}
  ],
  "lastMove": {"x":3,"y":4},
  "deadStones": [[2,3]],
  "score": null,
  "result": null,
  "createdAt": "2026-11-02T12:40:00.000Z",
  "updatedAt": "2026-11-02T12:41:00.000Z"
}
字段说明：

captures.black = 黑方提掉的白子数；captures.white = 白方提掉的黑子数

lastMove = 最后一手非 pass 落子（pass 不更新；从未落子则为 null）

deadStones = 被标记为死的点坐标列表（scoring 阶段可增删；ended 阶段保留）

score = playing 阶段 null；scoring / ended 阶段为 §4.4 结构；认输导致的 ended，score 为 null，result 为 "B+R"/"W+R"

result = ended 阶段为最终结果字符串；其他阶段 null

hashHistory 内部字段不对外暴露（存盘时保留）

6. Agent（Coder）接入方式 —— 项目内无任何 agent 代码
用户说"开一局"→ Coder curl POST /api/games（可指定路数/执子色）→ 拿 id → 告知用户浏览器打开 http://127.0.0.1:1358/?game=<id>（前端读 URL 参数自动加载该局）

循环：GET /api/games/:id → turn == agentColor 且 phase == "playing" 时 Coder 自行推理选点 → POST move；非法着 400 时按 code 换点重试（ILLEGAL_OCCUPIED/ILLEGAL_SUICIDE/ILLEGAL_KO 换点；ILLEGAL_TURN 说明状态过期，重查；WRONG_PHASE 停止落子进入下一步）；否则 sleep 2s 重查

scoring 阶段：GET 查 score，确认死子标记合理（如需调整调 dead-stone）→ confirm-score

用户落子无需通知，前端 1s 轮询可见 Agent 落子实时出现

7. 前端设计
7.1 Canvas 棋盘
木色底、网格线、星位（按路数定位：19 路 9 星、13 路 5 星、9 路 5 星）、棋子径向渐变、最后一手圆点标记、hover 半透明预览子、9/13/19 自适应尺寸、移动端可点

坐标标签：横向 A–T 跳过 I（19 个字母：A B C D E F G H J K L M N O P Q R S T）；纵向 从上到下为 N..1（即数组 y=0 显示 N，y=size-1 显示 1，符合围棋 1 在底部的习惯）

几何计算抽成纯函数（pointToXY、xyToPoint、starPoints(size)），可单测

7.2 信息栏与操作
阶段、当前行棋方（"你的回合 / 对方思考中"）、双方提子数、贴子数

操作：虚着、认输（二次确认）、新对局（选路数与执子色）

?color=black|white URL 参数：前端限制只能操作该色（点对方回合时提示"等待对方"；热座模式无此参数则双方均可操作）。服务端不鉴权，README 注明此为 UI 约束

7.3 scoring 阶段
提示"点击棋组标记死子"、实时比分面板（调 GET 拿 score 预览）、"确认数子"按钮

点棋组 → POST dead-stone → 重绘

7.4 ended
结果横幅（如"黑胜 10.5 目"或"白中盘胜"），score=null 时只显示 result

7.5 同步与竞态
1s 轮询 GET /api/games/:id，与本地状态 diff 后重绘

本地乐观更新 + 竞态处理：

用户落子时本地记 pendingSeq = state.moves.length + 1，立即乐观更新棋盘

POST move 响应为权威状态，直接覆盖本地

轮询响应若 resp.moves.length < pendingSeq → 丢弃（旧状态）

POST 失败（400）→ 回滚乐观更新，显示错误

?game=<id> URL 参数：打开即恢复；无参则显示"新对局"设置页

8. 任务分解（Claude Code 按 M0→M4 执行，核心模块 TDD）
M0 脚手架 —— Coder 亲自做
mkdir、git init、npm init -y、安装依赖（express、typescript、tsx、esbuild、vitest、@types/express、@types/node）、tsconfig.json（target: ES2022、module/moduleResolution: NodeNext、strict: true、outDir: dist、rootDir: src）、.env/.env.example/.gitignore（node_modules/、dist/、public/dist/、data/、.env）、scripts/build-web.mjs（esbuild：entry: web/main.ts、bundle: true、format: 'iife'、outfile: public/dist/bundle.js、platform: 'browser'、sourcemap: true）、scripts/dev.sh（trap 'kill 0' INT; tsx watch src/server.ts & node scripts/build-web.mjs --watch & wait）、package.json scripts（dev/build/test/start/prestart: npm run build）、最小 server.ts（health 路由 + express.static('public')）。

验证：npm run dev 启动，curl http://127.0.0.1:1358/api/health → {"ok":true,...}；commit chore: M0 scaffold。

M1 规则引擎（纯函数，vitest 驱动）
Task 1.1 types.ts + engine 骨架：Board 初始化、get/set、邻接点、Zobrist

Task 1.2 TDD 气与提子：单子被围提取、多子连通块整提、一手同时提两块

Task 1.3 TDD 禁自杀：无提子自杀拒；带提子的"自杀形"允许

Task 1.4 TDD 简单劫：立即回提拒（ILLEGAL_KO）、隔一手后允许；上一手是 pass 时不判劫

Task 1.5 TDD pass/连续两 pass → scoring；legalMoves 输出正确（不含自杀点、不含打劫点）

Task 1.6 TDD 计分（数子法）：领地划分、公气不计、死子归对方、贴子减黑、result 字符串（含 B+10.5 小数格式）

验证门槛：npx vitest run 全绿（预计 20+ 用例），Coder 审查边界用例；commit feat(M1): rules engine。

M2 服务端
Task 2.1 config.ts（loadEnvFile + 类型化 + 校验 + 默认值）

Task 2.2 store.ts：Map + data/<id>.json 原子写（tmp+rename）+ 启动扫描恢复；写失败策略：记录 error 日志，内存状态已生效，本次请求仍返回成功（README 注明"极端情况重启丢最后一手"）。单测：写→读→新 store 实例恢复一致

Task 2.3 routes/games.ts 全端点 + §5.1 校验 + 错误码映射；集成测试用 app.listen(0) 随机端口 + native fetch（不引入 supertest）：建局 → 黑白交替 5 手 → 同色连走断言 ILLEGAL_TURN → 非法落子断言 code → 双 pass → 标死子 → confirm → 断言 phase=ended 且 result 非空

验证门槛：npx vitest run 全绿 + 真实 1358 端口 curl 冒烟全端点 + 完整一局走到 ended；commit feat(M2): REST API + persistence。

M3 前端
Task 3.1 index.html/styles.css 骨架（布局、信息栏、按钮）

Task 3.2 board.ts Canvas 渲染（几何纯函数加单测）

Task 3.3 main.ts：建局 UI、?game= 恢复、?color= 限制、1s 轮询 + 竞态处理、点击落子、虚着/认输

Task 3.4 scoring UI（点死子、实时比分、确认）；ended 结果横幅

验证门槛：npm run build 产物无错且 public/dist/bundle.js 存在；curl -I http://127.0.0.1:1358/ 与 /dist/bundle.js 均 200；Coder 用浏览器工具或请用户手动验收走一局（建局→落子→虚着→死子→计分）；commit feat(M3): frontend。

M4 收尾
Task 4.1 README.md：简介、ASCII 架构图、安装/启动命令、.env 每项说明、"如何与 Agent 对弈"分步 curl 指南、已知局限（热座模式 / 简单劫 / 无鉴权仅本机 / 贴子不区分路数 / legalMoves 50–150ms 阻塞 / 写盘失败语义）

验证：按 README 从零走通一次；commit docs(M4): README。
