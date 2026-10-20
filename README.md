# kotori

一个 QQ ↔ KanonBot 消息转发机器人，内置本地计算器和 Codeforces / AtCoder Rating 查询（图片卡片）。

## 功能

- **消息转发**：`!` 开头的消息转发给 KanonBot（图片渲染、查分等），结果原样转发回 QQ 群。
- **本地计算器**：`cal` 命令，五则运算 `+ - * / %` 与括号，BigInt 精确计算，`/` 为向零取整除。
- **Codeforces 查询**：`cf` 命令，输出带段位配色、头像的 Rating 卡片图。
- **AtCoder 查询**：`at` 命令，输出 AtCoder 段位配色的 Rating 卡片图。
- **本地命令不依赖 KanonBot**：KanonBot 停机/维修时，`cal` / `cf` / `at` 仍可正常使用。
- **osu! 查询**：通过 `npm run cli` 提供 `recent` / `bp` / `info` / `score` 命令行查询。
- **彩蛋与启动公告**：均可通过 `.env` 配置开关。

## 架构

```
QQ 群
  │  OneBot V11（反向 WebSocket）
  ▼
NapCat / LLOneBot
  │
  ▼
kotori ──────── 转发 ! 开头的消息 ────────► KanonBot（图片渲染、查分等）
  │                                              │
  │  本地处理：cal / cf / at / help               │
  │                                              ▼
  └──────────────── 结果转发回 QQ 群 ◄───────────┘
```

## 技术栈

- TypeScript + Node.js
- OneBot V11 协议（`ws`）
- `@napi-rs/canvas`（Rating 卡片渲染）
- `dotenv`

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 `.env`

复制 `.env.example` 为 `.env`，按需填写（见下方「配置项」）。

### 3. 接入 QQ

先启动 NapCat / LLOneBot 并登录 QQ，把反向 WebSocket 指向本机 `ws://127.0.0.1:3001`，然后：

```bash
npm start
```

## QQ 群命令

| 命令 | 说明 |
|------|------|
| `cal <表达式>` | 五则运算 + - * / % 与括号，如 `cal (3*7+8)%12` |
| `cf <handle>` | Codeforces Rating（图片卡片） |
| `at <username>` | AtCoder Rating（图片卡片） |
| `help` / `帮助` / `?` | 显示帮助 |
| `!xxx` | 转发给 KanonBot 处理 |

> 本地命令（`cal` / `cf` / `at`）**不带** `!` 前缀；`!` 开头的消息才会转发给 KanonBot。
> 为避免把普通聊天误判成命令，命令需整行完全匹配（如 `cf tourist`），普通聊天不会触发。

## osu! 查询（CLI）

通过命令行使用，无需 QQ：

```bash
npm run cli                    # 进入交互式 REPL
npm run cli -- recent peppy    # 单次执行
```

| 命令 | 说明 |
|------|------|
| `recent <用户名或ID>` | 最近成绩 |
| `bp <用户名或ID>` | 最佳成绩 BP |
| `info <用户名或ID>` | 玩家信息 |
| `score <谱面ID>` | 谱面信息 |

使用前需在 `.env` 配置 `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET`。

## 配置项（.env）

| 变量 | 说明 |
|------|------|
| `OBT_WS_URL` | NapCat 反向 WebSocket 地址，默认 `ws://127.0.0.1:3001` |
| `NAPCAT_API` | NapCat HTTP API 地址，默认 `http://127.0.0.1:3000` |
| `NAPCAT_TOKEN` | NapCat HTTP token（需与 NapCat 端一致，否则 403） |
| `KANONBOT_WS_URL` | KanonBot WebSocket 地址 |
| `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET` | osu! API v2 凭证 |
| `EASTER_EGG_MESSAGE` / `EASTER_EGG_AT_QQ` | 群里发 `npm start` 时的彩蛋回复（文案留空则不触发） |
| `ANNOUNCE_GROUP_ID` / `ANNOUNCE_MESSAGE` / `ANNOUNCE_AT_QQ` | 启动公告（群号或文案留空则不发送） |
