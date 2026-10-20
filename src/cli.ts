// kotori 本地命令行入口：直连 osu! API v2 查询
// 用法：
//   npm run cli                       进入交互式 REPL
//   npm run cli -- recent peppy       带参数则执行一次后退出
import { config } from "dotenv";
config();

import readline from "readline";
import { OsuApiClient } from "./osu/client";
import { HELP_TEXT, executeCommand } from "./osu/commands";

const clientId = process.env.OSU_CLIENT_ID?.trim();
const clientSecret = process.env.OSU_CLIENT_SECRET?.trim();

function printMissingCredentialsAndExit(): never {
  console.error("未配置 osu! API v2 凭证，请在项目根目录 .env 中填写：");
  console.error("");
  console.error("  OSU_CLIENT_ID=你的Client ID");
  console.error("  OSU_CLIENT_SECRET=你的Client Secret");
  console.error("");
  console.error("申请地址：https://osu.ppy.sh/home/account/edit#oauth");
  console.error("（登录后拉到 OAuth 区域，新建一个应用即可拿到 ID 和 Secret）");
  process.exit(1);
}

if (!clientId || !clientSecret) {
  printMissingCredentialsAndExit();
}

const client = new OsuApiClient({ clientId: clientId!, clientSecret: clientSecret! });

function isExitCommand(line: string): boolean {
  return /^(exit|quit|q|退出)$/i.test(line.trim());
}

async function runOnce(line: string): Promise<void> {
  try {
    console.log(await executeCommand(line, client));
  } catch (e) {
    console.error(`查询失败：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  // 单次模式：命令行参数拼成一条命令
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    await runOnce(argv.join(" "));
    return;
  }

  // 交互模式
  console.log("kotori 本地 osu! 查询已启动（输入 help 查看命令，exit 退出）");
  console.log(HELP_TEXT);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", (line) => {
    if (isExitCommand(line)) {
      rl.close();
      return;
    }
    // 查询期间暂停读取，避免上一条未返回时下一行输出交错
    rl.pause();
    runOnce(line).finally(() => {
      rl.resume();
      rl.prompt();
    });
  });

  rl.on("close", () => {
    console.log("再见");
    process.exit(0);
  });
}

main();
