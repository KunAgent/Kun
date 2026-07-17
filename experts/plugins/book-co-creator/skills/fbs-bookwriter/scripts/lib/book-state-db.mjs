import "./suppress-node-sqlite-experimental-warning.mjs";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

function dbPathFor(bookRoot) {
  const fbsDir = path.join(bookRoot, ".fbs");
  fs.mkdirSync(fbsDir, { recursive: true });
  return path.join(fbsDir, "book-state.db");
}

function openDb(bookRoot) {
  const dbPath = dbPathFor(bookRoot);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
    CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);

    CREATE TABLE IF NOT EXISTS gate_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      status TEXT NOT NULL,
      code INTEGER,
      reason TEXT,
      evidence_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gate_results_ts ON gate_results(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_gate_results_gate_id ON gate_results(gate_id);
  `);
  return { db, dbPath };
}

function pruneDbIfNeeded(db, maxEvents = 5000, maxGateResults = 5000) {
  const evtCount = db.prepare("SELECT COUNT(*) AS c FROM events").get()?.c || 0;
  if (evtCount > maxEvents) {
    db.prepare(
      "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)",
    ).run(evtCount - maxEvents);
  }
  const gateCount = db.prepare("SELECT COUNT(*) AS c FROM gate_results").get()?.c || 0;
  if (gateCount > maxGateResults) {
    db.prepare(
      "DELETE FROM gate_results WHERE id IN (SELECT id FROM gate_results ORDER BY id ASC LIMIT ?)",
    ).run(gateCount - maxGateResults);
  }
}

function safeStringify(v) {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return JSON.stringify({ error: "payload-not-serializable" });
  }
}

export function appendBookStateEvent({
  bookRoot,
  source,
  eventType,
  level = "info",
  payload = null,
  ts = null,
}) {
  const root = path.resolve(bookRoot || process.cwd());
  const { db, dbPath } = openDb(root);
  try {
    const iso = ts || new Date().toISOString();
    db.prepare(
      "INSERT INTO events(ts, source, event_type, level, payload_json) VALUES (?, ?, ?, ?, ?)",
    ).run(iso, String(source || "unknown"), String(eventType || "event"), String(level || "info"), safeStringify(payload));
    pruneDbIfNeeded(db);
    return { ok: true, dbPath };
  } finally {
    db.close();
  }
}

export function appendGateResult({
  bookRoot,
  gateId,
  status,
  code = null,
  reason = null,
  evidence = null,
  ts = null,
}) {
  const root = path.resolve(bookRoot || process.cwd());
  const { db, dbPath } = openDb(root);
  try {
    const iso = ts || new Date().toISOString();
    db.prepare(
      "INSERT INTO gate_results(ts, gate_id, status, code, reason, evidence_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      iso,
      String(gateId || "unknown"),
      String(status || "unknown"),
      code == null ? null : Number(code),
      reason == null ? null : String(reason),
      safeStringify(evidence),
    );
    pruneDbIfNeeded(db);
    return { ok: true, dbPath };
  } finally {
    db.close();
  }
}

export function listRecentBookStateEvents({ bookRoot, limit = 20 }) {
  const root = path.resolve(bookRoot || process.cwd());
  const { db } = openDb(root);
  try {
    const rows = db
      .prepare("SELECT id, ts, source, event_type as eventType, level, payload_json as payloadJson FROM events ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Number(limit) || 20));
    return rows.map((r) => ({
      ...r,
      payload: (() => {
        try {
          return JSON.parse(r.payloadJson ?? "null");
        } catch {
          return null;
        }
      })(),
    }));
  } finally {
    db.close();
  }
}
