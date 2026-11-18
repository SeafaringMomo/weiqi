# AGENT.md — weiqi-app 实施指南

本文件是给 AI 编码 Agent 的项目指令。**与 `SPEC.md`（实施方案）配合使用**：`SPEC.md` 定义"做什么"，本文件定义"怎么做、做完怎么验、什么不许做"。

两者冲突时，以用户最新口头指示 > 本文件 > `SPEC.md` 为准。

---

## 0. 你的角色与铁律

你是本项目的实现工程师。项目是 **TypeScript 全栈围棋 Web 应用**：单进程 Express 托管 REST API + 静态前端，端口 1358，内存 + JSON 文件持久化，无数据库/无框架/无 WebSocket。

**铁律（违反任何一条即为不合格）：**

1. **逐段实施**：严格按 `SPEC.md` 第 8 节的 M0 → M1 → M2 → M3 → M4 顺序，一次只推进一个里程碑（M1/M2 内按 Task 顺序）。
2. **每段必须验证**：跑完验证命令、**贴出完整输出**，通过才 `git commit` 并进入下一段。失败 → 读错误 → 修复 → 重跑，**绝不"跳过"或"暂时注释掉"失败的测试**。
3. **验证连续失败 3 次**：停下来向用户报告，附最小复现（命令 + 错误 + 你的假设）。
4. **不擅自加依赖**：允许的运行时依赖只有 `express`；开发依赖只有 `typescript`、`tsx`、`esbuild`、`vitest`、`@types/express`、`@types/node`。**新增任何依赖前必须先问用户**（包括 supertest、concurrently、dotenv、nodemon、cors）。
5. **不硬编码配置**：端口、host、棋盘尺寸、贴目、数据目录、日志级别**全部来自 `config.ts`**（底层读 `.env`）。代码里出现 `1358`、`19`、`7.5`、`'./data'` 字面量即为缺陷（`.env.example` 和测试 fixture 除外）。
6. **规则引擎纯函数**：`src/game/engine.ts` 和 `src/game/scoring.ts` 不得 `import` express、fs、http、config；只依赖 `types.ts`。可被任意 Node 脚本 import 并测试。
7. **测试先行（仅 M1）**：M1 每个 Task 必须**先写 vitest 用例（红）→ 实现（绿）→ 必要时重构**。不允许"先实现再补测试"。
8. **不做需求外的事**：不加鉴权、不加 WebSocket、不加数据库、不加回放 UI、不加计时器。YAGNI 优先。
9.**包管理器**：使用包管理器yarn

---

curl -s http://192.168.137.96:1358/api/health   # 冒烟