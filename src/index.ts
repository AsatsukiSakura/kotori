// ebot - QQ ↔ KanonBot 消息转发机器人
// 架构: QQ → NapCat → ebot → KanonBot（图片渲染） → ebot → NapCat → QQ
import { config } from "dotenv";
config();

import WebSocket from "ws";
import { createServer, IncomingMessage } from "http";
import { Socket } from "net";
import { createKanonBot, KanonMessage } from "./kanon-bot";
import { calculate } from "./calc/calculator";
import {
  executeCommand as executeOjCommand,
  executeCodeforcesImage,
  executeAtCoderImage,
  type OjImageResult,
} from "./oj/commands";

// ==================== 配置 ====================

const OBT_WS_URL = process.env.OBT_WS_URL || "ws://127.0.0.1:3001";
const OBT_PORT = Number(new URL(OBT_WS_URL).port) || 3001;
const OBT_SELF_ID = process.env.OBT_SELF_ID;
const KANONBOT_WS_URL = process.env.KANONBOT_WS_URL || "ws://botws.desu.life:65000";
const FAKE_SELF_ID = Number(process.env.KANONBOT_SELF_ID || "10001");
const FAKE_USER_ID = Number(process.env.KANONBOT_TEST_USER || "10002");

// 启动公告：首次连上 NapCat 时主动发一条（群号留空则不发送）
const ANNOUNCE_GROUP_ID = Number(process.env.ANNOUNCE_GROUP_ID || "0");
const ANNOUNCE_MESSAGE = process.env.ANNOUNCE_MESSAGE || "";
const ANNOUNCE_AT_QQ = process.env.ANNOUNCE_AT_QQ || ""; // 空串 = 不 @
let announcementSent = false;

// 彩蛋：群里有人打出 "npm start" 时的回复（文案留空则彩蛋不触发）
const EASTER_EGG_MESSAGE = process.env.EASTER_EGG_MESSAGE || "";
const EASTER_EGG_AT_QQ = process.env.EASTER_EGG_AT_QQ || ""; // 空串 = 不 @

// ==================== OneBot 消息格式 ====================

interface ObtEvent {
  post_type: string;
  group_id?: number;
  user_id?: number;
  raw_message?: string;
  sender?: { nickname?: string };
}

// ==================== KanonBot 转发层 ====================

// 诊断追踪：每条转发消息独立追踪，用 msgId 做 key（避免同群连续发送造成覆盖）
const diagMap = new Map<number, { cmd: string; groupId: number; userId: number; ts: number }>();
const DIAG_TIMEOUT = 60_000; // 60 秒无回复即告警

const kanonBot = createKanonBot(
  KANONBOT_WS_URL,
  Number(FAKE_SELF_ID),
  (messages: KanonMessage[], _echo: string, replyGroupId?: number) => {
    if (replyGroupId) {
      // 收到回复，找到该群最早未完成的诊断记录并清除
      for (const [mid, d] of diagMap) {
        if (d.groupId === replyGroupId) {
          console.log(`[K] ✓ 回复到群 ${replyGroupId} (耗时${Math.round((Date.now()-d.ts)/1000)}s, cmd="${d.cmd}")`);
          diagMap.delete(mid);
          break; // 每次回复只清一条
        }
      }

      for (const seg of messages) {
        if (seg.type === "text") {
          sendToQQ(replyGroupId, seg.data);
        } else {
          sendImageToQQ(replyGroupId, seg.data);
        }
      }
    } else {
      console.log(`[K] 收到 send_msg 但无 group_id (丢弃)`);
    }
  },
  FAKE_USER_ID,
);

function forwardToKanonBot(groupId: number, rawMessage: string, userId?: number): void {
  if (kanonBot.getReadyState() !== WebSocket.OPEN) {
    console.log(`KanonBot 未连接 (readyState=${kanonBot.getReadyState()}), 跳过转发`);
    return;
  }
  const uid = userId ?? FAKE_USER_ID;
  const msgId = kanonBot.send(rawMessage, uid, groupId);

  // 记录诊断信息（用 msgId 做 key，每条独立追踪）
  const cmd = rawMessage.slice(0, 50);
  diagMap.set(msgId, { cmd, groupId, userId: uid, ts: Date.now() });
  console.log(`→ 转发到 KanonBot (userId=${uid} groupId=${groupId}): ${cmd}`);

  // 超时告警
  setTimeout(() => {
    if (diagMap.has(msgId)) {
      const d = diagMap.get(msgId)!;
      console.log(`[K] ⚠ 无回复: msgId=${msgId} groupId=${d.groupId} cmd="${d.cmd}" userId=${d.userId} (已等待${Math.round((Date.now()-d.ts)/1000)}s) — KanonBot 未响应`);
      diagMap.delete(msgId);
    }
  }, DIAG_TIMEOUT);
}

// ==================== 本地计算器（不依赖 KanonBot） ====================

function handleCalcCommand(groupId: number, expr: string): void {
  if (!expr) {
    sendToQQ(groupId, [
      "用法：",
      "cal <整数表达式>       五则运算 + - * / %（/ 为整除，向零取整）与括号",
      "示例：cal (3*7+8)%12+5*(12*3-17)-8/3   → 98",
    ].join("\n"));
    return;
  }

  const result = calculate(expr);
  if (result.ok) {
    const text = `= ${result.value.toString()}`;
    console.log(`[CAL] 群${groupId} ${expr} → ${text}`);
    sendToQQ(groupId, text);
  } else {
    console.log(`[CAL] 群${groupId} 计算失败 "${expr}" — ${result.error}`);
    sendToQQ(groupId, `计算失败：${result.error}`);
  }
}

// ==================== 彩蛋 ====================

// 群里有人打出 "npm start" 时回复一句（文案与是否 @ 由 .env 控制）
function handleEasterEgg(groupId: number): void {
  if (!EASTER_EGG_MESSAGE) return; // 未配置文案则不触发
  console.log(`[EGG] 群${groupId} 触发彩蛋 (npm start)`);
  if (EASTER_EGG_AT_QQ) {
    sendAtToQQ(groupId, EASTER_EGG_AT_QQ, EASTER_EGG_MESSAGE);
  } else {
    sendToQQ(groupId, EASTER_EGG_MESSAGE);
  }
}

// ==================== 本地 OJ Rating 查询（不依赖 KanonBot） ====================

async function handleOjCommand(groupId: number, rawMessage: string): Promise<void> {
  try {
    const text = await executeOjCommand(rawMessage);
    console.log(`[OJ] 群${groupId} ${rawMessage.slice(0, 60)} → ${text.slice(0, 80)}`);
    sendToQQ(groupId, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[OJ] 群${groupId} 查询失败 "${rawMessage}" — ${msg}`);
    sendToQQ(groupId, `查询失败：${msg}`);
  }
}

async function handleOjImage(
  groupId: number,
  rawMessage: string,
  run: (raw: string) => Promise<OjImageResult>,
): Promise<void> {
  try {
    const result = await run(rawMessage);
    if (result.ok) {
      console.log(`[OJ] 群${groupId} ${rawMessage.slice(0, 60)} → 生成卡片图片`);
      sendImageToQQ(groupId, result.base64);
    } else {
      console.log(`[OJ] 群${groupId} ${rawMessage.slice(0, 60)} → ${result.error}`);
      sendToQQ(groupId, result.error);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[OJ] 群${groupId} 查询失败 "${rawMessage}" — ${msg}`);
    sendToQQ(groupId, `查询失败：${msg}`);
  }
}

// ==================== QQ 入口 (OneBot) ====================

// NapCat HTTP API 地址
const NAPCAT_API = process.env.NAPCAT_API || "http://127.0.0.1:3000";
const NAPCAT_API_URL = new URL(NAPCAT_API);
const NAPCAT_TOKEN = process.env.NAPCAT_TOKEN || "";

function apiPost(path: string, body: object): void {
  const fullPath = NAPCAT_TOKEN ? `${path}?access_token=${NAPCAT_TOKEN}` : path;
  const postData = JSON.stringify(body);
  const req = require("http").request({
    hostname: NAPCAT_API_URL.hostname,
    port: NAPCAT_API_URL.port,
    path: fullPath,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  }, (res: any) => {
    let data = "";
    res.on("data", (chunk: string) => { data += chunk; });
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error(`  API ${path} 返回 ${res.statusCode}: ${data.slice(0, 300)}`);
      }
    });
  });
  req.on("error", (e: Error) => console.error(`  API ${path} 失败:`, e.message));
  req.write(postData);
  req.end();
}

function sendToQQ(groupId: number, text: string): void {
  console.log(`  → 发送文本到QQ群 ${groupId}: ${text.slice(0, 80)}`);
  apiPost("/send_msg", {
    message_type: "group",
    group_id: groupId,
    message: [{ type: "text", data: { text } }],
  });
}

function sendAtToQQ(groupId: number, qq: string, text: string): void {
  console.log(`  → @${qq} 发送到QQ群 ${groupId}: ${text.slice(0, 80)}`);
  // 用 CQ 码字符串形式，NapCat 会解析成真正的 @ 提及（对方会收到被 @ 的提醒），
  // 而不是把 "@" + QQ号 当作普通文字发出去。
  apiPost("/send_msg", {
    message_type: "group",
    group_id: groupId,
    message: `[CQ:at,qq=${qq}] ${text}`,
  });
}

function sendImageToQQ(groupId: number, image: string): void {
  // NapCat 的 image.file 接受：本地路径 / http(s) URL / file:// / base64:// 前缀。
  // 纯 base64 内容（既无路径也无 scheme）补上 base64:// 前缀，否则会被当成路径而发送失败。
  const isPathOrUrl = /^(https?:\/\/|file:\/\/|base64:\/\/|\/|[A-Za-z]:[\\/])/i.test(image);
  const file = isPathOrUrl ? image : `base64://${image}`;
  console.log(`  → 发送图片到QQ群 ${groupId} (${file.length} 字符)`);
  apiPost("/send_msg", {
    message_type: "group",
    group_id: groupId,
    message: [{ type: "image", data: { file } }],
  });
}

async function main() {
  // 全局错误捕获
  process.on("uncaughtException", (e) => console.error("[FATAL] 未捕获异常:", e));
  process.on("unhandledRejection", (e) => console.error("[FATAL] 未处理Promise拒绝:", e));

  const httpServer = createServer();
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  httpServer.listen(OBT_PORT, () => {
    console.log(`OneBot 服务已启动: ws://0.0.0.0:${OBT_PORT}`);
    console.log("等待 NapCat 连接...");
  });

  wss.on("connection", (obtWs) => {
    console.log("OneBot 客户端已连接");

    // 首次启动主动发一条公告（每次进程只发一次），可带 @
    // 群号或消息内容未配置时啥都不发
    if (!announcementSent && ANNOUNCE_GROUP_ID > 0 && ANNOUNCE_MESSAGE) {
      announcementSent = true;
      if (ANNOUNCE_AT_QQ) {
        sendAtToQQ(ANNOUNCE_GROUP_ID, ANNOUNCE_AT_QQ, ANNOUNCE_MESSAGE);
      } else {
        sendToQQ(ANNOUNCE_GROUP_ID, ANNOUNCE_MESSAGE);
      }
    }

    obtWs.on("message", (raw) => {
      const rawStr = raw.toString();
      let evt: ObtEvent;
      try { evt = JSON.parse(rawStr); }
      catch { return; }

      // 静默忽略 meta_event
      if (evt.post_type === "meta_event") return;

      if (evt.post_type !== "message") {
        console.log(`[OBT] 跳过 (post_type=${evt.post_type})`);
        return;
      }
      if (!evt.group_id) {
        console.log(`[OBT] 跳过 (无 group_id, 可能私聊)`);
        return;
      }
      if (!evt.raw_message) {
        console.log(`[OBT] 跳过 (无 raw_message)`);
        return;
      }
      const trimmedMessage = evt.raw_message.trim();
      if (!trimmedMessage) return;

      const logIncoming = (): void => {
        console.log(`[QQ←群${evt.group_id}] ${evt.sender?.nickname || "?"}: ${evt.raw_message!.slice(0, 80)}`);
      };

      // 彩蛋：群里有人打出 "npm start"
      if (/^npm\s+start$/i.test(trimmedMessage)) {
        logIncoming();
        handleEasterEgg(evt.group_id);
        return;
      }

      // 本地命令一律不带 ! 前缀，命中即本地处理，不经过 KanonBot（其停机/维修时也可用）。
      // 为了不把普通聊天误判成命令，命令必须"整行完全匹配"：
      //   cf / at 要求整行 = 命令 + 空格 + 一个合法用户名（纯 ASCII 字母数字 . _ -），
      //   这样 "at 3点开会"、"cf 一下"、"At first, ..." 都会被当成普通聊天忽略。
      // 只写命令不写参数时，回复用法提示，方便群友发现命令。
      const HANDLE_ARG = /^[A-Za-z0-9_.-]{1,32}$/;
      const CALC_ARG = /^[0-9+\-*/%()\s]{1,200}$/;

      // cf / codeforces <handle>
      const cfMatch = /^(?:cf|codeforces)(?:\s+(\S+))?$/i.exec(trimmedMessage);
      if (cfMatch && (!cfMatch[1] || HANDLE_ARG.test(cfMatch[1]))) {
        logIncoming();
        void handleOjImage(evt.group_id, cfMatch[1] ? trimmedMessage : "cf", executeCodeforcesImage);
        return;
      }

      // at / atcoder <username>
      const atMatch = /^(?:at|atcoder)(?:\s+(\S+))?$/i.exec(trimmedMessage);
      if (atMatch && (!atMatch[1] || HANDLE_ARG.test(atMatch[1]))) {
        logIncoming();
        void handleOjImage(evt.group_id, atMatch[1] ? trimmedMessage : "at", executeAtCoderImage);
        return;
      }

      // cal <整数表达式>
      const calMatch = /^cal(?:\s+(.+))?$/i.exec(trimmedMessage);
      if (calMatch && (!calMatch[1] || CALC_ARG.test(calMatch[1]))) {
        logIncoming();
        handleCalcCommand(evt.group_id, calMatch[1]?.trim() ?? "");
        return;
      }

      // help / 帮助 / ?
      if (/^(help|帮助|\?)$/i.test(trimmedMessage)) {
        logIncoming();
        void handleOjCommand(evt.group_id, trimmedMessage);
        return;
      }

      // 其余：只有 ! 开头的消息才转发给 KanonBot 处理，不带 ! 的普通聊天忽略
      if (evt.raw_message.startsWith("!") || evt.raw_message.startsWith("！")) {
        logIncoming();
        forwardToKanonBot(evt.group_id, evt.raw_message, evt.user_id);
      }
    });

    obtWs.on("close", (code) => {
      console.log(`OneBot 客户端断开 (code: ${code})`);
    });

    obtWs.on("error", (e) => {
      console.error("OneBot WS 错误:", e.message);
    });
  });

  httpServer.on("error", (e: Error) => {
    console.error("OneBot 服务器错误:", e.message);
  });
}

main();
