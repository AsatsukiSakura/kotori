// OJ 查询结果卡片：把 Codeforces / AtCoder 的用户信息渲染成 PNG
// 两张卡片共用同一套版式，靠左上角的"小标"（badge）与各自的 rating 配色区分平台
// 依赖 @napi-rs/canvas（Skia 渲染，预编译二进制，免本地编译）
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import type { AtCoderRatingEntry, CodeforcesUserInfo } from "./types";

// ==================== 字体 ====================

// 字体注册（Windows 系统字体，best-effort；找不到则用默认字体兜底）
let fontsRegistered = false;
function ensureFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const tryFont = (path: string, alias: string): void => {
    try {
      GlobalFonts.registerFromPath(path, alias);
    } catch {
      /* 字体缺失或格式不支持则忽略 */
    }
  };
  tryFont("C:\\Windows\\Fonts\\segoeui.ttf", "ui"); // 正文
  tryFont("C:\\Windows\\Fonts\\segoeuib.ttf", "uib"); // 粗体
  tryFont("C:\\Windows\\Fonts\\simhei.ttf", "cn"); // 中文兜底（如组织名含汉字）
}

/** 含中日韩文字时改用中文字体，否则用西文字体（避免汉字渲染成方框） */
const HAS_CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
function textFont(text: string, size: number, bold = false): string {
  const family = HAS_CJK.test(text) ? "cn" : bold ? "uib" : "ui";
  return `${size}px ${family}`;
}

// ==================== 平台小标 ====================

interface Badge {
  text: string;
  bg: string;
  fg: string;
}

/** Codeforces 小标：官方蓝底白字 */
const CF_BADGE: Badge = { text: "Codeforces", bg: "#1f8acb", fg: "#ffffff" };
/** AtCoder 小标：浅底黑字（AtCoder 品牌色为黑） */
const ATC_BADGE: Badge = { text: "AtCoder", bg: "#ededed", fg: "#1a1a1a" };

// ==================== 配色 ====================

/** Codeforces rank → 主题色（与官网评级颜色一致） */
const CF_RANK_COLOR: Record<string, string> = {
  unrated: "#9aa0a6",
  newbie: "#808080",
  pupil: "#008000",
  specialist: "#03a89e",
  expert: "#0000ff",
  "candidate master": "#aa00aa",
  master: "#ff8c00",
  "international master": "#ff8c00",
  grandmaster: "#ff0000",
  "international grandmaster": "#ff0000",
  "legendary grandmaster": "#ff0000",
};

function cfRankColor(rank?: string): string {
  return (rank && CF_RANK_COLOR[rank.toLowerCase()]) || "#9aa0a6";
}

/** AtCoder 段位分界（rating 下限）、段位名与配色，与 AtCoder 官方 rating 色一致 */
const ATC_RANKS: ReadonlyArray<{ min: number; name: string; color: string }> = [
  { min: 2800, name: "Red", color: "#ff0000" },
  { min: 2400, name: "Orange", color: "#ff8000" },
  { min: 2000, name: "Yellow", color: "#c0c000" },
  { min: 1600, name: "Blue", color: "#0000ff" },
  { min: 1200, name: "Cyan", color: "#00c0c0" },
  { min: 800, name: "Green", color: "#008000" },
  { min: 400, name: "Brown", color: "#804000" },
  { min: 0, name: "Gray", color: "#808080" },
];

function atcRank(rating: number): { name: string; color: string } {
  for (const r of ATC_RANKS) {
    if (rating >= r.min) return r;
  }
  return ATC_RANKS[ATC_RANKS.length - 1];
}

// ==================== 绘制工具 ====================

/** 圆角矩形路径（不依赖 roundRect，保证兼容） */
function roundRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 超出宽度则截断加省略号（调用前需先设好 font） */
function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

/** 时间戳（秒）→ YYYY-MM-DD */
function formatDate(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 圆形头像；无头像或加载失败时退回首字母圆块 */
async function drawAvatar(
  ctx: SKRSContext2D,
  avatarUrl: string | undefined,
  initial: string,
  cx: number,
  cy: number,
  r: number,
  color: string,
): Promise<void> {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let img: Image | null = null;
  if (avatarUrl) {
    try {
      img = await loadImage(avatarUrl);
    } catch {
      img = null;
    }
  }

  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.floor(r * 1.1)}px ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial.slice(0, 1).toUpperCase(), cx, cy);
  }
  ctx.restore();

  // 头像外圈
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
}

/** 画平台小标（圆角胶囊），返回其宽度 */
function drawBadge(ctx: SKRSContext2D, x: number, y: number, badge: Badge): number {
  const fontSize = 20;
  const padX = 14;
  const h = 34;
  ctx.font = `bold ${fontSize}px ui`;
  const w = Math.ceil(ctx.measureText(badge.text).width) + padX * 2;

  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = badge.bg;
  ctx.fill();

  ctx.fillStyle = badge.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge.text, x + w / 2, y + h / 2 + 1);
  return w;
}

// ==================== 卡片版式 ====================

interface CardSpec {
  badge: Badge;
  /** 主题色（rank 配色）：左侧竖条、标题、rating 数值、头像外圈 */
  color: string;
  title: string;
  subtitle: string;
  meta: string;
  footer: string;
  ratingText: string;
  maxRatingText: string;
  /** MAX RATING 数值的颜色（最高 rating 所处段位的配色） */
  maxColor: string;
  avatarUrl?: string;
  initial: string;
}

const CARD_W = 1200;
const CARD_H = 400;
const COL_LEFT = 288; // 文字列左边界
const COL_TEXT_MAX = 790 - COL_LEFT; // 文字列可用宽度（右列从 790 起）
const COL_RIGHT = 1150; // 数值列右对齐位置

/** 渲染通用卡片 */
async function renderCard(spec: CardSpec): Promise<Buffer> {
  ensureFonts();

  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");

  // 背景（深色渐变）
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, "#232733");
  bg.addColorStop(1, "#151720");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 左侧主题色竖条
  ctx.fillStyle = spec.color;
  ctx.fillRect(0, 0, 10, CARD_H);

  // 头像
  await drawAvatar(ctx, spec.avatarUrl, spec.initial, 160, 192, 90, spec.color);

  // 左列：平台小标 + 身份信息
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  drawBadge(ctx, COL_LEFT, 46, spec.badge);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = textFont(spec.title, 58, true);
  ctx.fillStyle = spec.color;
  ctx.fillText(fitText(ctx, spec.title, COL_TEXT_MAX), COL_LEFT, 120);

  ctx.font = textFont(spec.subtitle, 28);
  ctx.fillStyle = "#9aa0a6";
  ctx.fillText(fitText(ctx, spec.subtitle, COL_TEXT_MAX), COL_LEFT, 178);

  ctx.font = textFont(spec.meta, 25);
  ctx.fillStyle = "#c9cdd6";
  ctx.fillText(fitText(ctx, spec.meta, COL_TEXT_MAX), COL_LEFT, 226);

  ctx.font = textFont(spec.footer, 23);
  ctx.fillStyle = "#7a8089";
  ctx.fillText(fitText(ctx, spec.footer, COL_TEXT_MAX), COL_LEFT, 276);

  // 右列：Rating 数值
  ctx.textAlign = "right";

  ctx.font = "24px ui";
  ctx.fillStyle = "#7a8089";
  ctx.fillText("RATING", COL_RIGHT, 100);

  const numeric = /^\d+$/.test(spec.ratingText);
  ctx.font = textFont(spec.ratingText, numeric ? 96 : 56, true);
  ctx.fillStyle = spec.color;
  ctx.fillText(spec.ratingText, COL_RIGHT, 176);

  ctx.font = "24px ui";
  ctx.fillStyle = "#7a8089";
  ctx.fillText("MAX RATING", COL_RIGHT, 256);

  ctx.font = textFont(spec.maxRatingText, 42);
  ctx.fillStyle = spec.maxRatingText === "—" ? "#7a8089" : spec.maxColor;
  ctx.fillText(spec.maxRatingText, COL_RIGHT, 306);

  return canvas.encode("png");
}

/** Codeforces 用户卡片 */
export async function renderCodeforcesCard(u: CodeforcesUserInfo): Promise<Buffer> {
  const rating = u.rating ?? 0;
  const maxRating = u.maxRating ?? 0;
  const meta = [u.country, u.organization].filter(Boolean).join("  ·  ");
  const rankTitle = (u.rank ?? "unrated").replace(/\b\w/g, (c) => c.toUpperCase());

  return renderCard({
    badge: CF_BADGE,
    color: cfRankColor(u.rank),
    title: u.handle,
    subtitle: rankTitle,
    meta,
    footer: u.registrationTimeSeconds ? `Joined ${formatDate(u.registrationTimeSeconds)}` : "",
    ratingText: rating > 0 ? String(rating) : "unrated",
    maxRatingText: maxRating > 0 ? String(maxRating) : "—",
    maxColor: CF_RANK_COLOR[(u.maxRank ?? "").toLowerCase()] ?? cfRankColor(u.rank),
    avatarUrl: u.avatar,
    initial: u.handle,
  });
}

/** AtCoder 用户卡片（依据 rating 历史统计当前/最高 rating） */
export async function renderAtCoderCard(
  user: string,
  entries: AtCoderRatingEntry[],
): Promise<Buffer> {
  const last = entries[entries.length - 1];
  const rated = entries.filter((e) => e.IsRated);
  const current = last.NewRating;
  // 最高 rating 只统计正式 rated 场次（AtCoder 规则：provisional 不计入最高）
  const pool = rated.length > 0 ? rated : entries;
  const highest = pool.reduce((m, e) => Math.max(m, e.NewRating), pool[0].NewRating);

  const rank = atcRank(current);
  // ContestScreenName 形如 "agc077.contest.atcoder.jp"，去掉域名后缀只留短名
  const contest = last.ContestScreenName.replace(/\.contest\.atcoder\.jp$/, "");
  const recent = last.Place
    ? `Recent ${contest} · ${last.OldRating} → ${last.NewRating} · #${last.Place}`
    : `Recent ${contest} · ${last.OldRating} → ${last.NewRating}`;

  return renderCard({
    badge: ATC_BADGE,
    color: rank.color,
    title: user,
    subtitle: rank.name,
    meta: `Rated ${rated.length} contests${last.IsRated ? "" : " · provisional"}`,
    footer: recent,
    ratingText: String(current),
    maxRatingText: String(highest),
    maxColor: atcRank(highest).color,
    initial: user,
  });
}
