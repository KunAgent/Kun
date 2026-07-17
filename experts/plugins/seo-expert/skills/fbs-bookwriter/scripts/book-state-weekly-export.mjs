#!/usr/bin/env node
import "./lib/suppress-node-sqlite-experimental-warning.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    days: 7,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--days") o.days = Number(argv[++i] || 7);
    else if (a === "--json") o.json = true;
  }
  return o;
}

function startOfPeriod(days) {
  const ms = Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

export function getIsoWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function openDbIfExists(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  return new DatabaseSync(dbPath);
}

function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function runBookStateWeeklyExport({ bookRoot, days = 7, weekLabel = null } = {}) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbsDir = path.join(root, ".fbs");
  fs.mkdirSync(fbsDir, { recursive: true });
  const dbPath = path.join(fbsDir, "book-state.db");
  const fromTs = startOfPeriod(days);

  const result = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    root,
    dbPath,
    windowDays: Math.max(1, Number(days) || 7),
    fromTs,
    eventTotal: 0,
    gateTotal: 0,
    eventByType: [],
    eventBySource: [],
    gateByStatus: [],
    topFailingGates: [],
    latestFailures: [],
  };

  const db = openDbIfExists(dbPath);
  if (db) {
    try {
      result.eventTotal = db.prepare("SELECT COUNT(*) AS c FROM events WHERE ts >= ?").get(fromTs)?.c || 0;
      result.gateTotal = db.prepare("SELECT COUNT(*) AS c FROM gate_results WHERE ts >= ?").get(fromTs)?.c || 0;
      result.eventByType = db
        .prepare(
          "SELECT event_type AS eventType, COUNT(*) AS count FROM events WHERE ts >= ? GROUP BY event_type ORDER BY count DESC",
        )
        .all(fromTs);
      result.eventBySource = db
        .prepare("SELECT source, COUNT(*) AS count FROM events WHERE ts >= ? GROUP BY source ORDER BY count DESC")
        .all(fromTs);
      result.gateByStatus = db
        .prepare("SELECT status, COUNT(*) AS count FROM gate_results WHERE ts >= ? GROUP BY status ORDER BY count DESC")
        .all(fromTs);
      result.topFailingGates = db
        .prepare(
          "SELECT gate_id AS gateId, COUNT(*) AS failCount FROM gate_results WHERE ts >= ? AND status IN ('fail','failed','error') GROUP BY gate_id ORDER BY failCount DESC LIMIT 5",
        )
        .all(fromTs);
      result.latestFailures = db
        .prepare(
          "SELECT ts, gate_id AS gateId, status, reason FROM gate_results WHERE ts >= ? AND status IN ('fail','failed','error') ORDER BY id DESC LIMIT 10",
        )
        .all(fromTs);
    } finally {
      db.close();
    }
  }

  const week = weekLabel || getIsoWeekLabel(new Date());
  const reportDir = path.join(fbsDir, "reports");
  const jsonPath = path.join(reportDir, `book-state-weekly-summary-${week}.json`);
  const mdPath = path.join(reportDir, `book-state-weekly-summary-${week}.md`);
  writeFileSafe(jsonPath, JSON.stringify(result, null, 2) + "\n");

  const md = [
    `# Book State Weekly Summary (${week})`,
    "",
    `- 统计窗口: 最近 ${result.windowDays} 天`,
    `- 起始时间: ${result.fromTs}`,
    `- 事件总数: ${result.eventTotal}`,
    `- 门禁记录总数: ${result.gateTotal}`,
    "",
    "## Event Type Top",
    ...(result.eventByType.length
      ? result.eventByType.map((x) => `- ${x.eventType}: ${x.count}`)
      : ["- (no data)"]),
    "",
    "## Event Source Top",
    ...(result.eventBySource.length
      ? result.eventBySource.map((x) => `- ${x.source}: ${x.count}`)
      : ["- (no data)"]),
    "",
    "## Gate Status",
    ...(result.gateByStatus.length
      ? result.gateByStatus.map((x) => `- ${x.status}: ${x.count}`)
      : ["- (no data)"]),
    "",
    "## Top Failing Gates",
    ...(result.topFailingGates.length
      ? result.topFailingGates.map((x) => `- ${x.gateId}: ${x.failCount}`)
      : ["- (no data)"]),
  ].join("\n");
  writeFileSafe(mdPath, `${md}\n`);

  return { code: 0, message: "ok", jsonPath, mdPath, ...result };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error("用法: node scripts/book-state-weekly-export.mjs --book-root <本书根> [--days 7] [--json]");
    process.exit(2);
  }
  const out = runBookStateWeeklyExport(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[book-state-weekly-export] ${out.message}`);
    console.log(`[book-state-weekly-export] eventTotal=${out.eventTotal} gateTotal=${out.gateTotal}`);
    console.log(`[book-state-weekly-export] json=${out.jsonPath}`);
    console.log(`[book-state-weekly-export] md=${out.mdPath}`);
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
