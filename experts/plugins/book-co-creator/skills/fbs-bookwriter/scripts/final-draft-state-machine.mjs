#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { appendBookStateEvent } from "./lib/book-state-db.mjs";

const VALID_STATES = new Set(["draft", "candidate", "release", "archived"]);
const ALLOWED_TRANSITIONS = {
  draft: new Set(["candidate"]),
  candidate: new Set(["draft", "release"]),
  release: new Set(["candidate", "archived"]),
  archived: new Set([]),
};

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    action: "status",
    to: null,
    artifact: null,
    reason: "",
    actor: "fbs-agent",
    force: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") o.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--action") o.action = argv[++i] || "status";
    else if (a === "--to") o.to = argv[++i] || "";
    else if (a === "--artifact") o.artifact = argv[++i] || "";
    else if (a === "--reason") o.reason = argv[++i] || "";
    else if (a === "--actor") o.actor = argv[++i] || "fbs-agent";
    else if (a === "--force") o.force = true;
    else if (a === "--json") o.json = true;
  }
  return o;
}

function ensureFbsDir(bookRoot) {
  const fbsDir = path.join(bookRoot, ".fbs");
  fs.mkdirSync(fbsDir, { recursive: true });
  return fbsDir;
}

function statePath(fbsDir) {
  return path.join(fbsDir, "final-draft-state.json");
}

function hashFile(filePath) {
  const raw = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function readState(bookRoot) {
  const fbsDir = ensureFbsDir(bookRoot);
  const p = statePath(fbsDir);
  if (!fs.existsSync(p)) {
    return {
      schemaVersion: "1.0.0",
      currentState: "draft",
      updatedAt: null,
      updatedBy: null,
      currentArtifact: null,
      currentHash: null,
      transitionHistory: [],
    };
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {
      schemaVersion: "1.0.0",
      currentState: "draft",
      updatedAt: null,
      updatedBy: null,
      currentArtifact: null,
      currentHash: null,
      transitionHistory: [],
    };
  }
}

function writeState(bookRoot, state) {
  const fbsDir = ensureFbsDir(bookRoot);
  const p = statePath(fbsDir);
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");
  return p;
}

function ensureTransitionAllowed(fromState, toState, force = false) {
  if (!VALID_STATES.has(toState)) {
    throw new Error(`invalid target state: ${toState}`);
  }
  if (!VALID_STATES.has(fromState)) {
    throw new Error(`invalid current state: ${fromState}`);
  }
  if (force) return;
  const allowed = ALLOWED_TRANSITIONS[fromState] || new Set();
  if (!allowed.has(toState)) {
    throw new Error(`transition not allowed: ${fromState} -> ${toState}`);
  }
}

function toRelative(bookRoot, maybePath) {
  if (!maybePath) return null;
  const abs = path.resolve(bookRoot, maybePath);
  if (!fs.existsSync(abs)) return null;
  return path.relative(bookRoot, abs).replace(/\\/g, "/");
}

function appendTransition(state, item) {
  const history = Array.isArray(state.transitionHistory) ? state.transitionHistory : [];
  history.push(item);
  state.transitionHistory = history.slice(-200);
}

export function runFinalDraftStateMachine({
  bookRoot,
  action = "status",
  to,
  artifact,
  reason = "",
  actor = "fbs-agent",
  force = false,
}) {
  if (!bookRoot) {
    return { code: 2, message: "missing --book-root" };
  }
  const state = readState(bookRoot);
  if (action === "status") {
    return { code: 0, message: "ok", state };
  }
  if (action !== "transition") {
    return { code: 2, message: `unsupported action: ${action}` };
  }
  const target = String(to || "").trim().toLowerCase();
  if (!target) {
    return { code: 2, message: "missing --to for transition" };
  }
  try {
    ensureTransitionAllowed(state.currentState, target, !!force);
  } catch (error) {
    return { code: 2, message: error.message, state };
  }

  const now = new Date().toISOString();
  const relArtifact = toRelative(bookRoot, artifact);
  const absArtifact = relArtifact ? path.resolve(bookRoot, relArtifact) : null;
  const artifactHash = absArtifact ? hashFile(absArtifact) : null;
  const from = state.currentState;

  state.currentState = target;
  state.updatedAt = now;
  state.updatedBy = actor;
  if (relArtifact) state.currentArtifact = relArtifact;
  if (artifactHash) state.currentHash = artifactHash;

  appendTransition(state, {
    at: now,
    from,
    to: target,
    actor,
    reason: reason || "",
    artifact: relArtifact,
    hash: artifactHash,
    force: !!force,
  });

  const p = writeState(bookRoot, state);
  try {
    appendBookStateEvent({
      bookRoot,
      source: "final-draft-state-machine",
      eventType: "final_draft_transition",
      level: "info",
      payload: {
        from,
        to: target,
        actor,
        reason: reason || "",
        artifact: relArtifact,
        hash: artifactHash,
        force: !!force,
      },
    });
  } catch {
    // 轻索引失败不影响主流程
  }
  return {
    code: 0,
    message: "transition recorded",
    statePath: p,
    state,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const out = runFinalDraftStateMachine(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[final-draft-state] ${out.message}`);
    if (out.state?.currentState) {
      console.log(`[final-draft-state] current=${out.state.currentState}`);
    }
    if (out.statePath) {
      console.log(`[final-draft-state] statePath=${out.statePath}`);
    }
  }
  process.exit(out.code);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
