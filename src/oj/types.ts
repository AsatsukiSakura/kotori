// Codeforces / AtCoder 公开数据响应类型（仅声明本项目用到的字段）
// Codeforces: https://codeforces.com/apiHelp/methods#user.info
// AtCoder:    https://atcoder.jp/users/{user}/history/json

/** Codeforces user.info 返回数组中的单个用户对象 */
export interface CodeforcesUserInfo {
  handle: string;
  /** 未参加 rating 时可能为 0 */
  rating?: number;
  maxRating?: number;
  /** "unrated" / "newbie" ... "legendary grandmaster" */
  rank?: string;
  maxRank?: string;
  country?: string;
  /** 头像图片 URL，如 https://userpic.codeforces.org/... */
  avatar?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  contribution?: number;
  friendOfCount?: number;
  /** 注册时间（Unix 秒） */
  registrationTimeSeconds?: number;
}

/** AtCoder /history/json 返回数组中的单条记录 */
export interface AtCoderRatingEntry {
  IsRated: boolean;
  Place: number;
  OldRating: number;
  NewRating: number;
  ContestScreenName: string;
  ContestName: string;
  /** RFC3339 时间，如 "2016-09-04T22:50:00+09:00" */
  EndTime: string;
}