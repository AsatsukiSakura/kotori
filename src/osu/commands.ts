// 命令层：解析用户输入 → 调用 OsuApiClient（具体 endpoint）→ 用 format 排版
// 不关心消息从哪里来（命令行 / 以后的 QQ），输入一行文字，输出一段文字
import { OsuApiClient, OsuApiError } from "./client";
import { OsuBeatmap, OsuScore, OsuUser } from "./types";
import { formatBeatmap, formatScoreList, formatUser } from "./format";

/** 当前只支持 osu!standard */
const MODE = "osu";
const RECENT_LIMIT = 5;
const BEST_LIMIT = 5;

export const HELP_TEXT = [
  "kotori 本地 osu! 查询（osu!standard），可用命令：",
  "  recent <用户名或ID>   最近成绩（含未通过，最多 5 条）",
  "  bp <用户名或ID>       最佳成绩 BP（前 5 条，含加权 PP）",
  "  info <用户名或ID>     玩家信息（排名 / PP / 准确率等）",
  "  score <谱面ID>        查询谱面信息（ID 为数字）",
  "  help                  显示本帮助",
  "示例：",
  "  recent peppy",
  "  bp 2",
  "  score 4142758",
].join("\n");

/** 用户名/ID 解析：纯数字按 ID 查，否则按用户名查 */
async function resolveUser(client: OsuApiClient, nameOrId: string): Promise<OsuUser> {
  const key = /^\d+$/.test(nameOrId) ? "id" : "username";
  return client.get<OsuUser>(`/users/${encodeURIComponent(nameOrId)}`, {
    key,
    mode: MODE,
  });
}

/** 把 404 转成更具体的中文提示，其余错误继续向上抛 */
function notFoundText(e: unknown, text: string): string | null {
  if (e instanceof OsuApiError && e.statusCode === 404) return text;
  return null;
}

async function cmdRecent(client: OsuApiClient, arg: string): Promise<string> {
  const user = await resolveUser(client, arg);
  const scores = await client.get<OsuScore[]>(
    `/users/${user.id}/scores/recent`,
    { mode: MODE, limit: RECENT_LIMIT, include_fails: 1 },
  );
  if (scores.length === 0) {
    return `${user.username} 近期（约 24 小时内）没有 osu! 成绩记录。`;
  }
  return `${user.username} 最近 ${scores.length} 条成绩：\n${formatScoreList(scores, false)}`;
}

async function cmdBest(client: OsuApiClient, arg: string): Promise<string> {
  const user = await resolveUser(client, arg);
  const scores = await client.get<OsuScore[]>(
    `/users/${user.id}/scores/best`,
    { mode: MODE, limit: BEST_LIMIT },
  );
  if (scores.length === 0) {
    return `${user.username} 还没有任何 ranked 成绩，无法列出 BP。`;
  }
  return `${user.username} 的 BP 前 ${scores.length}：\n${formatScoreList(scores, true)}`;
}

async function cmdInfo(client: OsuApiClient, arg: string): Promise<string> {
  const user = await resolveUser(client, arg);
  return formatUser(user);
}

async function cmdBeatmap(client: OsuApiClient, arg: string): Promise<string> {
  if (!/^\d+$/.test(arg)) {
    return "谱面 ID 必须是数字，例如：score 4142758";
  }
  const beatmap = await client.get<OsuBeatmap>(`/beatmaps/${arg}`);
  return formatBeatmap(beatmap);
}

/**
 * 执行一条命令
 * @param rawInput 原始输入行（允许带 ! / ！ 前缀，方便以后复用 QQ 命令习惯）
 * @returns 给用户看的文字结果
 */
export async function executeCommand(rawInput: string, client: OsuApiClient): Promise<string> {
  const line = rawInput.trim().replace(/^[!！]\s*/, "").trim();
  if (!line) return HELP_TEXT;

  // 用户名可能含空格：第一个空白前是命令，其余整体作为参数
  const spaceIdx = line.search(/\s/);
  const cmd = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
  const arg = (spaceIdx === -1 ? "" : line.slice(spaceIdx + 1)).trim();

  try {
    switch (cmd) {
      case "help":
      case "帮助":
      case "?":
        return HELP_TEXT;

      case "recent":
      case "r":
      case "最近":
        if (!arg) return "用法：recent <用户名或ID>";
        return await cmdRecent(client, arg);

      case "bp":
      case "best":
      case "bests":
      case "最佳":
        if (!arg) return "用法：bp <用户名或ID>";
        return await cmdBest(client, arg);

      case "info":
      case "user":
      case "stats":
      case "信息":
      case "玩家":
        if (!arg) return "用法：info <用户名或ID>";
        return await cmdInfo(client, arg);

      case "score":
      case "map":
      case "beatmap":
      case "谱面":
        if (!arg) return "用法：score <谱面ID>";
        return await cmdBeatmap(client, arg);

      default:
        return `未知命令：${cmd}\n\n${HELP_TEXT}`;
    }
  } catch (e) {
    // 针对常见 404 给出语义化提示
    if (cmd === "score" || cmd === "map" || cmd === "beatmap" || cmd === "谱面") {
      const t = notFoundText(e, `找不到谱面 #${arg}（可能已被删除，或 ID 不正确）。`);
      if (t) return t;
    } else {
      const t = notFoundText(e, `找不到玩家 “${arg}”，请检查用户名或数字 ID 是否正确。`);
      if (t) return t;
    }
    throw e;
  }
}
