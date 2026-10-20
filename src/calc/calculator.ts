// 整数五则运算（+ - * / %）与括号，/ 为整除（向零取整）
// 设计：BigInt 整数运算 —— 无浮点误差、不溢出；BigInt 的 / 与 % 本身就是整数运算
// 安全：手写递归下降解析器，绝不使用 eval，群聊消息可直接传入
//
// 文法（优先级从低到高）：
//   expr    := term (('+' | '-') term)*
//   term    := factor (('*' | '/' | '%') factor)*
//   factor  := ('+' | '-') factor | primary        （一元正负号）
//   primary := NUMBER | '(' expr ')'

export type CalcResult =
  | { ok: true; value: bigint }
  | { ok: false; error: string };

/** 表达式最大长度，防止群聊恶意超长输入 */
const MAX_EXPR_LEN = 200;
/** 单个数字字面量最大位数（18 位，足够覆盖 QQ 号级别的数） */
const MAX_DIGITS = 18;

type TokenType = "num" | "op" | "lp" | "rp";

interface Token {
  type: TokenType;
  value: string;
}

class CalcError extends Error {}

// ==================== 词法分析 ====================

/** 词法分析：字符串 → token 序列，遇到非法字符立即报错 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // 空格与制表符直接跳过（允许 "cal (3*7 + 8) % 12" 这种写法）
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let digits = "";
      while (i < input.length && input[i] >= "0" && input[i] <= "9") {
        digits += input[i];
        i++;
      }
      if (digits.length > MAX_DIGITS) {
        throw new CalcError(`数字 ${digits.slice(0, MAX_DIGITS)}… 位数超过上限（最多 ${MAX_DIGITS} 位）`);
      }
      tokens.push({ type: "num", value: digits });
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lp", value: ch });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rp", value: ch });
      i++;
      continue;
    }

    // 最常见的误用单独给提示
    if (ch === ".") {
      throw new CalcError("不支持小数点，本计算器只做整数运算（/ 也是整除）");
    }
    throw new CalcError(`包含不支持的字符 “${ch}”，仅支持整数、+ - * / % 与括号 ()`);
  }

  return tokens;
}

// ==================== 语法分析 + 求值 ====================

/** 语法分析 + 求值（递归下降） */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  /** 入口：整体必须恰好是一个完整表达式 */
  parse(): bigint {
    if (this.tokens.length === 0) {
      throw new CalcError("表达式为空");
    }
    const value = this.parseExpr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (t.type === "rp") throw new CalcError("右括号 ) 多余，或左侧缺少 (");
      throw new CalcError("表达式格式有误，请检查运算符和数字之间是否缺漏");
    }
    return value;
  }

  /** 加减层 */
  private parseExpr(): bigint {
    let left = this.parseTerm();

    for (;;) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "+" && t.value !== "-")) break;
      this.next();
      const right = this.parseTerm();
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }

  /** 乘、整除、取模层 */
  private parseTerm(): bigint {
    let left = this.parseFactor();

    for (;;) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "*" && t.value !== "/" && t.value !== "%")) break;
      this.next();
      const right = this.parseFactor();
      if (t.value === "*") {
        left = left * right;
      } else {
        // BigInt 的 / 与 % 均为整数运算（向零取整），除零抛 RangeError
        if (right === 0n) {
          throw new CalcError(t.value === "/" ? "除数不能为 0" : "取模的右值不能为 0");
        }
        left = t.value === "/" ? left / right : left % right;
      }
    }
    return left;
  }

  /** 一元正负号层（可叠加，如 --3、-+2） */
  private parseFactor(): bigint {
    const t = this.peek();
    if (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const v = this.parseFactor();
      return t.value === "-" ? -v : v;
    }
    return this.parsePrimary();
  }

  /** 数字 / 括号层 */
  private parsePrimary(): bigint {
    const t = this.next();

    if (!t) {
      throw new CalcError("表达式不完整，末尾缺少数字或括号");
    }

    if (t.type === "num") {
      return BigInt(t.value);
    }

    if (t.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
      throw new CalcError(`运算符 ${t.value} 前缺少数字或括号`);
    }

    if (t.type === "rp") {
      throw new CalcError("意外的右括号 )");
    }

    if (t.type === "lp") {
      // 允许空括号立刻给出明确错误
      if (this.peek()?.type === "rp") throw new CalcError("括号 ( ) 内缺少表达式");
      const value = this.parseExpr();
      const closing = this.next();
      if (!closing || closing.type !== "rp") {
        throw new CalcError("括号未闭合，缺少右括号 )");
      }
      return value;
    }

    throw new CalcError("表达式格式有误");
  }
}

/**
 * 计算整数表达式
 * @param rawExpression 用户输入的表达式（可含空格），如 "(3*7+8)%12-8/3"
 * @returns 成功返回整数，失败返回中文错误信息
 */
export function calculate(rawExpression: string): CalcResult {
  const expr = rawExpression.trim();

  if (expr.length === 0) return { ok: false, error: "表达式为空" };
  if (expr.length > MAX_EXPR_LEN) {
    return { ok: false, error: `表达式过长（最多 ${MAX_EXPR_LEN} 个字符）` };
  }

  try {
    const tokens = tokenize(expr);
    const value = new Parser(tokens).parse();
    return { ok: true, value };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    // BigInt 除零等运行期错误兜底
    return { ok: false, error: e instanceof Error ? e.message : "无法解析的表达式" };
  }
}