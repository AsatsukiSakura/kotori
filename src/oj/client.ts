// OJ（Codeforces / AtCoder）底层客户端：只负责 HTTPS GET 传输，不包含业务逻辑
// 参考 OJ_Insight：AtCoder 需带浏览器 User-Agent，否则可能被拦
import { get as httpsGet, RequestOptions } from "https";
import { AtCoderRatingEntry, CodeforcesUserInfo } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36 OJ-Insight/0.5";
const REQUEST_TIMEOUT_MS = 15_000;

/** 所有 OJ 查询的底层错误统一抛出这个类型 */
export class OjApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OjApiError";
  }
}

interface HttpResponse {
  statusCode: number;
  body: string;
}

function httpGet(host: string, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const opts: RequestOptions = {
      method: "GET",
      hostname: host,
      path,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    };
    const req = httpsGet(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000}秒）`));
    });
    req.on("error", reject);
    req.end();
  });
}

/** GET 并解析 JSON；非 200 或非法 JSON 抛 OjApiError */
async function getJson(host: string, path: string, label: string): Promise<unknown> {
  const res = await httpGet(host, path);
  if (res.statusCode !== 200) {
    throw new OjApiError(`${label} 请求失败（HTTP ${res.statusCode}）`, res.statusCode, res.body.slice(0, 300));
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new OjApiError(`${label} 响应不是合法 JSON`, res.statusCode, res.body.slice(0, 300));
  }
}

/**
 * CF 头像 URL 改写：user.info 返回的 avatar 是 https://userpic.codeforces.org/...
 * 该域名直连会 503（CDN 回源故障），但走 codeforces.com 主站反代路径能正常 200。
 * 因此把 host 换成 codeforces.com，并把原 host 拼进路径 /userpic.codeforces.org/...
 */
function rewriteUserpicUrl(url?: string): string | undefined {
  if (!url) return url;
  return url.replace(
    /^https?:\/\/userpic\.codeforces\.org\//,
    "https://codeforces.com/userpic.codeforces.org/",
  );
}

/**
 * Codeforces 用户信息（官方 user.info API）
 * @returns 找到返回用户对象；用户不存在返回 null
 */
export async function getCodeforcesUser(handle: string): Promise<CodeforcesUserInfo | null> {
  const raw = (await getJson(
    "codeforces.com",
    `/api/user.info?handles=${encodeURIComponent(handle)}&lang=en`,
    "Codeforces",
  )) as { status?: string; result?: CodeforcesUserInfo[]; comment?: string };

  if (raw.status !== "OK") {
    // FAILED 且 comment 明确表示用户不存在 → 返回 null；否则（如限流）按错误抛出
    if (raw.status === "FAILED" && /not found/i.test(raw.comment ?? "")) return null;
    throw new OjApiError(raw.comment ?? `Codeforces API 返回异常（status=${raw.status}）`);
  }
  const list = raw.result ?? [];
  if (list.length === 0) return null;
  const user = list[0];
  user.avatar = rewriteUserpicUrl(user.avatar);
  return user;
}

/**
 * AtCoder Rating 历史（/history/json，公开 JSON，无需登录）
 * 注意：用户不存在与该用户从未参赛时，本接口都返回 []，需配合 atCoderUserExists 区分。
 */
export async function getAtCoderRatingHistory(user: string): Promise<AtCoderRatingEntry[]> {
  const arr = (await getJson(
    "atcoder.jp",
    `/users/${encodeURIComponent(user)}/history/json`,
    "AtCoder",
  )) as AtCoderRatingEntry[];
  return Array.isArray(arr) ? arr : [];
}

/** AtCoder 用户是否存在（profile 页 404 视为不存在） */
export async function atCoderUserExists(user: string): Promise<boolean> {
  const res = await httpGet("atcoder.jp", `/users/${encodeURIComponent(user)}`);
  return res.statusCode === 200;
}