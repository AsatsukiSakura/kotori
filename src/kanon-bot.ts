// KanonBot WebSocket 连接共享模块
// 封装连接、保活、重连、消息解析，避免 index.ts 和 connect-kanon.ts 重复代码
import WebSocket from "ws";

export interface KanonMessage {
  type: "text" | "image";
  data: string;
}

export interface KanonBotInstance {
  /** 发送 osu 命令到 KanonBot，返回消息 ID 供调用方跟踪 */
  send: (rawMessage: string, userId: number, groupId: number) => number;
  /** 关闭连接 */
  close: () => void;
  /** 获取当前 readyState */
  getReadyState: () => number;
}

/**
 * 连接到 KanonBot WebSocket 服务器
 * @param url       KanonBot WebSocket 地址
 * @param selfId    机器人自身 QQ 号（用于 X-Self-ID 头）
 * @param onResponse  收到 KanonBot 回复时回调（已解析为 KanonMessage 数组）
 * @param defaultUserId  构造假消息时的默认 user_id
 */
export function createKanonBot(
  url: string,
  selfId: number,
  onResponse: (messages: KanonMessage[], echo: string, groupId?: number) => void,
  defaultUserId: number,
): KanonBotInstance {
  const ts = () => new Date().toISOString().slice(11, 23);

  let ws: WebSocket | null = null;
  let reconnecting = false;
  let msgIdCounter = 1;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function startPing(): void {
    stopPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);
  }

  function stopPing(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function buildFakeMessage(rawMessage: string, userId: number, groupId: number, msgId: number) {
    return {
      time: Math.floor(Date.now() / 1000),
      self_id: selfId,
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: msgId,
      group_id: groupId,
      user_id: userId,
      message: [{ type: "text", data: { text: rawMessage } }],
      raw_message: rawMessage,
      font: 0,
      anonymous: null,
      sender: {
        user_id: userId,
        nickname: "RelayUser",
        card: "",
        sex: "unknown",
        age: 0,
      },
    };
  }

  function connect(): void {
    if (reconnecting) return;
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }

    reconnecting = true;
    console.log(`[${ts()}] 连接 KanonBot: ${url}`);

    ws = new WebSocket(url, {
      headers: {
        "X-Client-Role": "Universal",
        "X-Self-ID": String(selfId),
      },
    });

    ws.on("open", () => {
      reconnecting = false;
      startPing();
      console.log(`[${ts()}] 已连接 KanonBot (readyState=${ws!.readyState})`);
      // 替死 ping 已禁用测试 — 怀疑它在 Universal 连接上造成了状态污染
      // ws!.send(JSON.stringify({
      //   time: Math.floor(Date.now() / 1000),
      //   self_id: selfId,
      //   post_type: "message",
      //   message_type: "private",
      //   sub_type: "friend",
      //   message_id: 0,
      //   user_id: defaultUserId,
      //   message: [{ type: "text", data: { text: "!ping" } }],
      //   raw_message: "!ping",
      //   font: 0,
      //   sender: { user_id: defaultUserId, nickname: "Guard", sex: "unknown", age: 0 },
      // }));
    });

    ws.on("message", (data: Buffer | string) => {
      const rawStr = typeof data === "string" ? data : data.toString();
      console.log(`[${ts()}] [K原始] ${rawStr.slice(0, 300)}`);

      let msg: any;
      try { msg = JSON.parse(rawStr); }
      catch { console.log(`[${ts()}] [K原始] JSON解析失败, raw=${rawStr.slice(0, 100)}`); return; }

      if (msg.action === "send_msg" || msg.action?.includes("send")) {
        console.log(`[${ts()}] [K] 收到 send_msg`);
        const message = msg.params?.message;
        const segments: KanonMessage[] = [];

        if (Array.isArray(message)) {
          for (const seg of message) {
            if (seg.type === "text" && seg.data?.text) {
              segments.push({ type: "text", data: seg.data.text });
            } else if (seg.type === "image") {
              const img = seg.data?.file ?? seg.data?.url ?? "";
              if (img) segments.push({ type: "image", data: img });
            }
          }
        } else if (typeof message === "string" && message) {
          segments.push({ type: "text", data: message });
        }

        onResponse(segments, msg.echo ?? "", msg.params?.group_id);

        // 回应 echo，让 KanonBot 不阻塞
        if (msg.echo && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            echo: msg.echo, status: "ok", retcode: 0,
            data: { message_id: msgIdCounter++ },
          }));
        }
        return;
      }

      if (msg.meta_event_type) {
        console.log(`[${ts()}] [KanonBot] ${msg.meta_event_type}`);
        return;
      }

      console.log(`[${ts()}] [KanonBot 未知] ${JSON.stringify(msg).slice(0, 300)}`);
    });

    ws.on("close", (code: number) => {
      stopPing();
      console.log(`[${ts()}] KanonBot 断开 (code: ${code}), 3秒后重连...`);
      reconnecting = false;
      ws = null;
      setTimeout(() => connect(), 3000);
    });

    ws.on("error", (err: Error) => {
      console.error(`[${ts()}] KanonBot WS 错误:`, err.message);
    });

    console.log(`[${ts()}] KanonBot 事件监听已注册`);
  }

  // 启动连接
  connect();

  return {
    send(rawMessage: string, userId: number, groupId: number): number {
      const msgId = msgIdCounter++;
      const fakeMsg = buildFakeMessage(rawMessage, userId, groupId, msgId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(fakeMsg), (err) => {
          if (err) console.error(`[${ts()}] 发送失败:`, err.message);
          else console.log(`[${ts()}] 已发送 msgId=${msgId}: ${rawMessage}`);
        });
      } else {
        console.log(`[${ts()}] KanonBot 未连接，消息丢弃: ${rawMessage.slice(0, 50)}`);
      }
      return msgId;
    },

    close(): void {
      stopPing();
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
    },

    getReadyState(): number {
      return ws?.readyState ?? -1;
    },
  };
}
