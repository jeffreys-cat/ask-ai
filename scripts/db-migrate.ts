import { spawn } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  await run("pnpm", ["--filter", "@selectdb/db", "exec", "drizzle-kit", "migrate", "--config", "drizzle.config.ts"]);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
