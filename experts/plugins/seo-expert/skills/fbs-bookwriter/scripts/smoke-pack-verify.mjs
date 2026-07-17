#!/usr/bin/env node
/**
 * 发布包 / 宿主安装环境轻量自检（不依赖 Vitest）。
 * 完整单元测试仅在源码仓执行：npm test
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(relScript, extraArgs) {
  const script = path.join(ROOT, relScript);
  return spawnSync(process.execPath, [script, ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
}

const v = run("scripts/validate-runtime-hints.mjs", ["--skill-root", ROOT]);
if (v.status !== 0) process.exit(typeof v.status === "number" ? v.status : 1);

const e = run("scripts/env-preflight.mjs", ["--json"]);
if (e.status !== 0) process.exit(typeof e.status === "number" ? e.status : 1);

console.log("[smoke-pack] OK（validate-runtime-hints + env-preflight）。完整单测请在源码仓执行 npm test）");
process.exit(0);
