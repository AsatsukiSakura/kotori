// osu! API v2 响应类型（仅声明本项目用到的字段）
// 文档: https://osu.ppy.sh/docs/index.html

/** 谱面所属谱面组（歌曲） */
export interface OsuBeatmapset {
  title: string;
  title_unicode?: string | null;
  artist: string;
  artist_unicode?: string | null;
  creator: string;
  covers?: {
    cover: string;
    card: string;
    list: string;
  };
}

/** 谱面 GET /beatmaps/{id}，成绩对象中内嵌的 beatmap 也是同一结构 */
export interface OsuBeatmap {
  id: number;
  beatmapset_id: number;
  status: string;
  url: string;
  version: string; // 难度名
  mode: string;
  difficulty_rating: number; // 星数
  ar: number;
  cs: number;
  accuracy: number; // OD
  drain: number; // HP
  bpm: number | null;
  total_length: number; // 含休息段（秒）
  hit_length: number; // 不含休息段（秒）
  max_combo: number | null;
  count_circles?: number;
  count_sliders?: number;
  beatmapset?: OsuBeatmapset | null;
}

/** 成绩（lazer 新计分 / legacy 成绩的共有字段） */
export interface OsuScore {
  id: number;
  user_id: number;
  accuracy: number; // 0~1
  /** lazer 下可能是 { acronym: "DT" } 对象，legacy 下是字符串 */
  mods: Array<string | { acronym: string }>;
  score: number; // legacy 总分
  total_score?: number; // lazer 总分
  max_combo: number;
  passed: boolean;
  pp: number | null;
  rank: string;
  perfect: boolean;
  created_at: string;
  statistics: {
    count_300?: number;
    count_100?: number;
    count_50?: number;
    count_miss?: number;
    count_geki?: number;
    count_katu?: number;
  };
  weight?: {
    percentage: number; // 0~1
    pp: number;
  } | null;
  position?: number | null;
  beatmap?: OsuBeatmap | null;
}

/** 玩家 GET /users/{user} */
export interface OsuUser {
  id: number;
  username: string;
  avatar_url?: string;
  join_time: string;
  country: {
    code: string;
    name: string;
  };
  statistics: {
    pp: number;
    global_rank: number | null;
    country_rank?: number | null;
    hit_accuracy: number;
    play_count: number;
    play_time: number; // 秒
    ranked_score: number;
    total_score: number;
    total_hits: number;
    maximum_combo: number;
    level: {
      current: number;
      progress: number;
    };
    grade_counts: {
      ss: number;
      ssh: number;
      s: number;
      sh: number;
      a: number;
    };
  };
}
