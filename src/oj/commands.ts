// 命令层：解析用户输入 → 调用 OJ 客户端 → 输出结果（图片卡片 / 文字）
// 不关心消息从哪里来（命令行 / QQ），输入一行文字，输出结果
import { atCoderUserExists, getAtCoderRatingHistory, getCodeforcesUser } from "./client";
import { renderAtCoderCard, renderCodeforcesCard } from "./image";

export const HELP_TEXT = [
  "kotori 本地命令（直接输入，无需前缀）：",
  "  cal <表达式>      五则运算 + - * / %（/ 为整除，向零取整）与括号",
  "  cf <handle>       Codeforces 当前/最高 rating（图片卡片）",
  "  at <username>     AtCoder 当前/最高 rating（图片卡片）",
  "  help              显示本帮助",
  "示例：",
  "  cal (3*7+8)%12",
  "  cf tourist",
  "  at chokudai",
  "注：以 ! 开头的命令由 KanonBot 处理。",
].join("\n");

/** 拆出命令与参数（命令不带 ! 前缀） */
function splitRaw(rawInput: string): { cmd: string; arg: string } {
  const line = rawInput.trim();
  if (!line) return { cmd: "", arg: "" };
  const spaceIdx = line.search(/\s/);
  const cmd = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
  const arg = (spaceIdx === -1 ? "" : line.slice(spaceIdx + 1)).trim();
  return { cmd, arg };
}

/** 文字类命令（目前只有 help，其余命令各自有专门的入口） */
export async function executeCommand(rawInput: string): Promise<string> {
  const { cmd } = splitRaw(rawInput);
  if (!cmd || cmd === "help" || cmd === "帮助" || cmd === "?") return HELP_TEXT;
  return `未知命令：${cmd}\n\n${HELP_TEXT}`;
}

export type OjImageResult = { ok: true; base64: string } | { ok: false; error: string };

/** Codeforces 卡片：查询用户 → 渲染 PNG → 返回 base64 */
export async function executeCodeforcesImage(rawInput: string): Promise<OjImageResult> {
  const { arg } = splitRaw(rawInput);
  if (!arg) return { ok: false, error: "用法：cf <handle>，例如 cf tourist" };
  const u = await getCodeforcesUser(arg);
  if (!u) return { ok: false, error: `Codeforces 找不到用户 “${arg}”，请检查 handle 拼写。` };
  try {
    const buf = await renderCodeforcesCard(u);
    return { ok: true, base64: buf.toString("base64") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "生成图片失败" };
  }
}

/** AtCoder 卡片：查询 rating 历史 → 渲染 PNG → 返回 base64 */
export async function executeAtCoderImage(rawInput: string): Promise<OjImageResult> {
  const { arg } = splitRaw(rawInput);
  if (!arg) return { ok: false, error: "用法：at <username>，例如 at chokudai" };
  const entries = await getAtCoderRatingHistory(arg);
  if (entries.length === 0) {
    // 两种空：用户不存在 或 用户存在但从未参加 rating 比赛
    const exists = await atCoderUserExists(arg);
    if (!exists) return { ok: false, error: `AtCoder 找不到用户 “${arg}”，请检查用户名拼写。` };
    return { ok: false, error: `AtCoder 用户 “${arg}” 尚未参加任何 rating 比赛，暂无 Rating。` };
  }
  try {
    const buf = await renderAtCoderCard(arg, entries);
    return { ok: true, base64: buf.toString("base64") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "生成图片失败" };
  }
}
