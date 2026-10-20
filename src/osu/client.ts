// osu! API v2 底层客户端：只负责 OAuth 鉴权与 HTTP 传输，不包含任何业务逻辑
// 鉴权方式: client_credentials（公开数据访问）
// 文档: https://osu.ppy.sh/docs/index.html
import { request, RequestOptions } from "https";

const OSU_HOST = "osu.ppy.sh";
const API_PREFIX = "/api/v2";
const REQUEST_TIMEOUT_MS = 15_000;
/** 令牌提前 60 秒视为过期，避免边界请求撞上 401 */
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export interface OsuClientConfig {
  clientId: string;
  clientSecret: string;
}

/** 所有 osu! API 相关错误统一抛出这个类型，业务层可按 statusCode 区分处理 */
export class OsuApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OsuApiError";
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface HttpResponse {
  statusCode: number;
  body: string;
}

export class OsuApiClient {
  private accessToken: string | null = null;
  /** 令牌过期时间（epoch 毫秒） */
  private tokenExpiresAt = 0;

  constructor(private readonly cfg: OsuClientConfig) {}

  /** 基于 Node 内置 https 的最小请求封装，零第三方依赖 */
  private rawRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const opts: RequestOptions = {
        method,
        hostname: OSU_HOST,
        path,
        headers,
      };
      const req = request(opts, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000}秒）`));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  /** 使用 client_credentials 申请访问令牌并缓存 */
  private async fetchToken(): Promise<void> {
    const form = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: "client_credentials",
      scope: "public",
    }).toString();

    const res = await this.rawRequest("POST", "/oauth/token", {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(form)),
      Accept: "application/json",
    }, form);

    if (res.statusCode !== 200) {
      throw new OsuApiError(
        `获取 osu! 访问令牌失败（HTTP ${res.statusCode}），请检查 OSU_CLIENT_ID / OSU_CLIENT_SECRET 是否正确`,
        res.statusCode,
        res.body.slice(0, 300),
      );
    }

    let tok: TokenResponse;
    try {
      tok = JSON.parse(res.body);
    } catch {
      throw new OsuApiError("令牌响应解析失败", res.statusCode, res.body.slice(0, 300));
    }

    this.accessToken = tok.access_token;
    this.tokenExpiresAt =
      Date.now() + tok.expires_in * 1000 - TOKEN_EXPIRY_SAFETY_MS;
  }

  private async ensureToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.fetchToken();
    }
    return this.accessToken!;
  }

  /**
   * 发起带鉴权的 GET 请求
   * @param path   以 / 开头的 API 路径（不含 /api/v2 前缀）
   * @param query  查询参数，值为 undefined 的字段会被跳过
   */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.requestWithAuth<T>(path, query, true);
  }

  private async requestWithAuth<T>(
    path: string,
    query: Record<string, string | number | undefined> | undefined,
    allowRetry: boolean,
  ): Promise<T> {
    const token = await this.ensureToken();

    let qs = "";
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const s = params.toString();
      if (s) qs = `?${s}`;
    }

    const res = await this.rawRequest(
      "GET",
      `${API_PREFIX}${path}${qs}`,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    );

    // 令牌意外失效：强制刷新一次后重试（只重试一次，避免死循环）
    if (res.statusCode === 401 && allowRetry) {
      this.accessToken = null;
      return this.requestWithAuth<T>(path, query, false);
    }
    if (res.statusCode === 404) {
      throw new OsuApiError("请求的资源不存在（HTTP 404）", 404, res.body.slice(0, 300));
    }
    if (res.statusCode === 429) {
      throw new OsuApiError("osu! API 请求过于频繁，已被限流（HTTP 429），请稍后再试", 429, res.body.slice(0, 300));
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new OsuApiError(`osu! API 请求失败（HTTP ${res.statusCode}）`, res.statusCode, res.body.slice(0, 300));
    }

    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new OsuApiError("osu! API 响应不是合法 JSON", res.statusCode, res.body.slice(0, 300));
    }
  }
}
