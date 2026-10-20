// 排版层：把 osu! API 返回的原始数据格式化为中文纯文字
// 全部为无副作用纯函数，不发起任何网络请求
import { OsuBeatmap, OsuScore, OsuUser } from "./types";

/** 千分位数字，null/undefined 显示为 — */
function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** 0~1 的小数 → 百分比字符串 */
function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 秒 → m:ss */
function duration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** 秒 → x.x 小时 */
function hours(sec: number): string {
  return `${(sec / 3600).toLocaleString("en-US", { maximumFractionDigits: 1 })}小时`;
}

/** ISO 时间 → 本地 MM-DD HH:mm */
function localTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 兼容 lazer（对象）与 legacy（字符串）两种 mods 形式 */
function modsText(mods: Array<string | { acronym: string }> | undefined): string {
  if (!mods || mods.length === 0) return "NM";
  return mods.map((m) => (typeof m === "string" ? m : m.acronym)).join("");
}

/** 统一取谱面标题，优先显示原语言标题 */
function beatmapTitle(b: OsuBeatmap): string {
  const set = b.beatmapset;
  const title = set?.title_unicode || set?.title || `谱面 #${b.id}`;
  return `${title} [${b.version}]`;
}

const STATUS_TEXT: Record<string, string> = {
  ranked: "Ranked（已 ranked）",
  approved: "Approved",
  qualified: "Qualified（资格中）",
  loved: "Loved",
  pending: "Pending（待定）",
  graveyard: "Graveyard（坟场）",
  wip: "WIP",
};

/** 玩家信息 */
export function formatUser(u: OsuUser): string {
  const s = u.statistics;
  const lines = [
    `${u.username} (ID: ${u.id})`,
    `国家/地区: ${u.country.code} | 注册时间: ${localTime(u.join_time)}`,
    `全球排名: ${s.global_rank === null ? "未上榜" : "#" + num(s.global_rank, 0)}` +
      ` | 地区排名: ${s.country_rank === null || s.country_rank === undefined ? "未上榜" : "#" + num(s.country_rank, 0)}`,
    `PP: ${num(s.pp)} | 准确率: ${pct(s.hit_accuracy)}`,
    `游玩次数: ${num(s.play_count, 0)} | 总时长: ${hours(s.play_time)} | 等级: ${s.level.current}`,
    `最大连击: ${num(s.maximum_combo, 0)}x | 总命中: ${num(s.total_hits, 0)}`,
    `评级: SS ${s.grade_counts.ssh + s.grade_counts.ss}(银${s.grade_counts.ssh})` +
      ` / S ${s.grade_counts.sh + s.grade_counts.s}(银${s.grade_counts.sh})` +
      ` / A ${s.grade_counts.a}`,
    `主页: https://osu.ppy.sh/users/${u.id}`,
  ];
  return lines.join("\n");
}

/**
 * 单条成绩
 * @param index 序号（1 起）
 * @param withWeight 是否显示加权 PP（bp 列表需要，recent 不需要）
 */
export function formatScoreLine(score: OsuScore, index: number, withWeight: boolean): string {
  const b = score.beatmap;
  const rank = score.passed ? score.rank : "FAIL";
  const st = score.statistics;
  const head = b
    ? `${index}. [${rank} ${modsText(score.mods)}] ${beatmapTitle(b)} ★${b.difficulty_rating.toFixed(2)}`
    : `${index}. [${rank} ${modsText(score.mods)}] 谱面 #${score.id}`;

  const detailParts = [
    `准确率 ${pct(score.accuracy)}`,
    `连击 ${num(score.max_combo, 0)}x`,
    `300/100/50/X ${num(st.count_300, 0)}/${num(st.count_100, 0)}/${num(st.count_50, 0)}/${num(st.count_miss, 0)}`,
    `PP ${score.pp === null ? "—（未结算）" : num(score.pp)}`,
    `总分 ${num(score.score, 0)}`,
  ];
  if (withWeight && score.weight) {
    detailParts.push(`加权${num(score.weight.pp)}pp @${pct(score.weight.percentage, 0)}`);
  }

  const lines = [head, "   " + detailParts.join(" | ")];
  if (b) {
    lines.push(`   ${localTime(score.created_at)} | ${b.url}`);
  } else {
    lines.push(`   ${localTime(score.created_at)}`);
  }
  return lines.join("\n");
}

/** 多条成绩列表 */
export function formatScoreList(scores: OsuScore[], withWeight: boolean): string {
  return scores
    .map((s, i) => formatScoreLine(s, i + 1, withWeight))
    .join("\n");
}

/** 谱面信息 */
export function formatBeatmap(b: OsuBeatmap): string {
  const set = b.beatmapset;
  const title = set?.title_unicode || set?.title || `谱面 #${b.id}`;
  const artist = set?.artist_unicode || set?.artist || "未知";
  const lines = [
    `${title} [${b.version}]`,
    `艺术家: ${artist} | 谱师: ${set?.creator ?? "—"}` +
      ` | 状态: ${STATUS_TEXT[b.status] ?? b.status}`,
    `星数 ★${b.difficulty_rating.toFixed(2)} | BPM ${b.bpm ?? "—"}` +
      ` | 时长 ${duration(b.total_length)} | 最大连击 ${b.max_combo === null ? "—" : b.max_combo + "x"}`,
    `CS ${b.cs} / AR ${b.ar} / OD ${b.accuracy} / HP ${b.drain}` +
      ` | 谱面组 #${b.beatmapset_id}`,
    `链接: ${b.url || `https://osu.ppy.sh/beatmaps/${b.id}`}`,
  ];
  return lines.join("\n");
}
