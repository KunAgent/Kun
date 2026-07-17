#!/usr/bin/env node
/**
 * 多 Writer 心跳巡检（升级版）：
 * - 2m：WARN
 * - 5m：PING
 * - 10m：SHUTDOWN_REQUEST
 * - 15m：CRITICAL（建议改派）
 * - shutdown_request 发出后 30s 无响应：FORCE_TERMINATE
 *
 * 用法：
 *   node scripts/heartbeat-monitor.mjs --book-root <本书根>
 *   node scripts/heartbeat-monitor.mjs --book-root <本书根> --emit-actions
 */
import fs from "fs";
import path from "path";

const DEFAULTS = {
  warnMs: 2 * 60 * 1000,
  pingAfterMs: 5 * 60 * 1000,
  shutdownAfterMs: 10 * 60 * 1000,
  criticalAfterMs: 15 * 60 * 1000,
  forceTerminateAfterShutdownMs: 30 * 1000,
};

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    warnMs: DEFAULTS.warnMs,
    pingAfterMs: DEFAULTS.pingAfterMs,
    shutdownAfterMs: DEFAULTS.shutdownAfterMs,
    criticalAfterMs: DEFAULTS.criticalAfterMs,
    forceTerminateAfterShutdownMs: DEFAULTS.forceTerminateAfterShutdownMs,
    failOnCritical: false,
    failOnShutdown: false,
    emitActions: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--warn-ms") o.warnMs = Math.max(1000, Number(argv[++i]) || DEFAULTS.warnMs);
    else if (a === "--ping-after-ms") o.pingAfterMs = Math.max(o.warnMs, Number(argv[++i]) || DEFAULTS.pingAfterMs);
    else if (a === "--shutdown-after-ms") o.shutdownAfterMs = Math.max(o.pingAfterMs, Number(argv[++i]) || DEFAULTS.shutdownAfterMs);
    else if (a === "--critical-after-ms") o.criticalAfterMs = Math.max(o.shutdownAfterMs, Number(argv[++i]) || DEFAULTS.criticalAfterMs);
    else if (a === "--force-terminate-after-shutdown-ms") o.forceTerminateAfterShutdownMs = Math.max(1000, Number(argv[++i]) || DEFAULTS.forceTerminateAfterShutdownMs);
    else if (a === "--fail-on-critical") o.failOnCritical = true;
    else if (a === "--fail-on-shutdown") o.failOnShutdown = true;
    else if (a === "--emit-actions") o.emitActions = true;
  }
  return o;
}

function parseIsoMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}

function formatAge(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function classify(ageMs, cfg) {
  if (ageMs >= cfg.criticalAfterMs) return "CRITICAL";
  if (ageMs >= cfg.shutdownAfterMs) return "SHUTDOWN_REQUEST";
  if (ageMs >= cfg.pingAfterMs) return "PING";
  if (ageMs >= cfg.warnMs) return "WARN";
  return "OK";
}

function main() {
  const args = parseArgs(process.argv);

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
heartbeat-monitor.mjs — 多 Writer 心跳巡检工具

用法:
  node scripts/heartbeat-monitor.mjs --book-root <本书根> [选项]

选项:
  --book-root <路径>               书稿工程根目录（必填）
  --emit-actions                   将巡检动作建议写入 .fbs/heartbeat-actions.json
  --warn-ms <ms>                   WARN 阈值，默认 120000（2分钟）
  --ping-after-ms <ms>             PING 阈值，默认 300000（5分钟）
  --shutdown-after-ms <ms>         SHUTDOWN_REQUEST 阈值，默认 600000（10分钟）
  --critical-after-ms <ms>         CRITICAL 阈值，默认 900000（15分钟）
  --force-terminate-after-shutdown-ms <ms>  强制终止延迟，默认 30000（30秒）
  --fail-on-critical               存在 CRITICAL 成员时以非零退出码退出
  --fail-on-shutdown               存在 SHUTDOWN_REQUEST 成员时以非零退出码退出
  -h, --help                       显示此帮助

适用范围与局限说明（BUG-005）:
  ⚠️  本工具通过读取 .fbs/member-heartbeats.json 中各成员的 lastHeartbeat 字段来判断心跳状态。
  ⚠️  此工具不支持直接监控 CodeBuddy Team 模式成员的心跳，原因如下：
      - CodeBuddy Team 模式成员不会自动写入 .fbs/member-heartbeats.json；
      - 宿主平台的 team member 生命周期由平台管理，本地 JSON 文件无法感知成员活跃状态。
  ✅  适用场景：自定义多智能体框架下，Writer 自行调用 scripts/record-heartbeat.mjs（或等效逻辑）
      定期更新 member-heartbeats.json 时，可通过本工具定期巡检超时成员并输出动作建议。
  ✅  CodeBuddy Team 模式下的心跳管理，应通过宿主平台的 team member 超时设置与 send_message 机制处理；
      本工具在 Team 模式下仅可作为辅助参考，不可作为成员是否响应的权威判断。

数据来源:
  .fbs/member-heartbeats.json  （由各 Writer 自行维护）

输出（--emit-actions 时）:
  .fbs/heartbeat-actions.json  （巡检动作建议）
`);
    process.exit(0);
  }

  if (!args.bookRoot) {
    console.error("用法: node scripts/heartbeat-monitor.mjs --book-root <本书根> [--emit-actions]\n       --help 查看完整说明（含适用范围）");
    process.exit(2);
  }

  const bookRoot = path.resolve(args.bookRoot);
  const hbPath = path.join(bookRoot, ".fbs", "member-heartbeats.json");
  if (!fs.existsSync(hbPath)) {
    console.error(`heartbeat-monitor: 文件不存在 ${hbPath}`);
    process.exit(2);
  }

  let j;
  try {
    j = JSON.parse(fs.readFileSync(hbPath, "utf8"));
  } catch (e) {
    console.error(`heartbeat-monitor: JSON 解析失败 ${hbPath}: ${e.message}`);
    process.exit(2);
  }

  const now = Date.now();
  const members = j && typeof j.members === "object" && j.members ? j.members : {};
  const ids = Object.keys(members);
  if (!ids.length) {
    console.log("heartbeat-monitor: members 为空（当前无活跃 writer）");
    process.exit(0);
  }

  let criticalCount = 0;
  let shutdownCount = 0;
  const actions = [];

  console.log(`heartbeat-monitor: ${bookRoot}`);
  console.log(`阈值: WARN>=${args.warnMs}ms, PING>=${args.pingAfterMs}ms, SHUTDOWN>=${args.shutdownAfterMs}ms, CRITICAL>=${args.criticalAfterMs}ms`);

  for (const id of ids) {
    const row = members[id] || {};
    const hbTs = parseIsoMs(row.lastHeartbeat || row.updatedAt || row.at);
    const shutdownTs = parseIsoMs(row.shutdownRequestedAt);

    if (!hbTs) {
      criticalCount += 1;
      actions.push({ memberId: id, action: "SHUTDOWN_REQUEST", reason: "missing_lastHeartbeat", at: new Date(now).toISOString() });
      console.log(`- ${id}: CRITICAL（缺少有效 lastHeartbeat） -> 立即 shutdown_request`);
      continue;
    }

    const age = now - hbTs;
    const state = classify(age, args);

    let action = "NONE";
    if (shutdownTs && now - shutdownTs >= args.forceTerminateAfterShutdownMs) {
      action = "FORCE_TERMINATE";
      criticalCount += 1;
    } else if (state === "SHUTDOWN_REQUEST") {
      action = "SHUTDOWN_REQUEST";
      shutdownCount += 1;
    } else if (state === "CRITICAL") {
      action = "SHUTDOWN_REQUEST";
      shutdownCount += 1;
      criticalCount += 1;
    } else if (state === "PING") {
      action = "PING";
    } else if (state === "WARN") {
      action = "WARN";
    }

    if (action !== "NONE") {
      actions.push({
        memberId: id,
        action,
        reason: state.toLowerCase(),
        ageMs: age,
        at: new Date(now).toISOString(),
      });
    }

    const tip =
      action === "FORCE_TERMINATE"
        ? "超过 shutdown_request 30s 无响应，执行强制终止"
        : action === "SHUTDOWN_REQUEST"
          ? "发 shutdown_request，并准备改派"
          : action === "PING"
            ? "发送催更 ping"
            : action === "WARN"
              ? "预警（2m无心跳）"
              : "继续观察";

    console.log(`- ${id}: ${state}（${formatAge(age)}） -> ${tip}`);
  }

  if (args.emitActions) {
    const outPath = path.join(bookRoot, ".fbs", "heartbeat-actions.json");
    const payload = {
      generatedAt: new Date(now).toISOString(),
      policy: {
        warnMs: args.warnMs,
        pingAfterMs: args.pingAfterMs,
        shutdownAfterMs: args.shutdownAfterMs,
        criticalAfterMs: args.criticalAfterMs,
        forceTerminateAfterShutdownMs: args.forceTerminateAfterShutdownMs,
      },
      actions,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`heartbeat-monitor: 已输出动作建议 ${outPath}`);
  }

  if (criticalCount > 0 && args.failOnCritical) process.exit(1);
  if (shutdownCount > 0 && args.failOnShutdown) process.exit(1);
  process.exit(0);
}

main();
