# kotori - osu! 查分转发 + graveyard 补刀机器人

## 架构

```
QQ群 → NapCat/LLOneBot → kotori → ws://botws.desu.life:65000 (KanonBot)
                            │
                            └→ osu! API v2 (graveyard 检测) → SQLite 本地库
```

kotori 作为中间转发层：
- 收到 QQ 命令 → 转发给 KanonBot（图片渲染、PP计算、ranked 图查询）
- KanonBot 的结果原样转发回 QQ 群
- 同时独立检测 graveyard 谱面 → 自动入库 → 文字补充信息

## 技术栈

- TypeScript + Node.js
- Drizzle ORM + sql.js (SQLite, 零配置)
- osu! API v2 + KanonBot OneBot WebSocket
- OneBot V11 协议 (QQ 消息收发)

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 获取 osu! API 凭证

https://osu.ppy.sh/home/account/edit#oauth → 注册 OAuth 应用

### 3. 配置 `.env`

```
OSU_CLIENT_ID=你的client_id
OSU_CLIENT_SECRET=你的client_secret
OBT_WS_URL=ws://127.0.0.1:3001      # NapCat/LLOneBot 地址
KANONBOT_WS_URL=ws://botws.desu.life:65000   # KanonBot 公网地址
```

### 4. 本地试用 (不需要 QQ)
```bash
npm run cli
> recent peppy        # 查分 + 自动收录 graveyard
> save 4142758        # 手动收录
> stats               # 数据库统计
```

### 5. 接入 QQ

先启动 NapCat/LLOneBot 登录 QQ，然后：
```bash
npm start
```

## 工作流程

1. 用户在QQ群发 `!recent peppy` 或 `!信息 peppy`
2. kotori 收到消息 → 转发给 KanonBot WS → KanonBot 查分渲染图片
3. KanonBot 的结果 → kotori 转发回 QQ 群（文字 + 图片）
4. 同时 kotori 调 osu! API 查近期成绩 → 检测 graveyard 谱面
5. 发现 graveyard → 查本地 SQLite → 没有就拉取存入 → 补一条文字信息

## 命令列表

| 命令 | 说明 |
|------|------|
| `!recent <用户名>` | 近期成绩 (KanonBot 图片 + kotori graveyard 补刀) |
| `!bp <用户名>` | 最佳成绩 |
| `!信息 <用户名>` | 玩家信息 |
| `!score <谱面ID>` | 查谱面 |
