#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { runFinalDraftStateMachine } from "./final-draft-state-machine.mjs";
import { createRelease, listReleases, RELEASE_STATUS } from "./releases-registry.mjs";
import { runFinalManuscriptCleanGate } from "./final-manuscript-clean-gate.mjs";

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    strict: false,
    dryRun: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--strict") out.strict = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function makeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listFinalCandidates(releasesDir) {
  if (!fs.existsSync(releasesDir)) return [];
  const all = fs.readdirSync(releasesDir)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => /(终稿|全稿)/.test(name))
    .map((name) => {
      const abs = path.join(releasesDir, name);
      const stat = fs.statSync(abs);
      return { name, abs, mtimeMs: stat.mtimeMs };
    });
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return all;
}

function resolveConfirmPinnedFile(releasesDir) {
  const confirmFiles = fs.existsSync(releasesDir)
    ? fs.readdirSync(releasesDir)
        .filter((name) => /^VERSION(?:-[\d.]+)?\.md$/i.test(name))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
    : [];
  for (const file of confirmFiles) {
    const abs = path.join(releasesDir, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    const m = text.match(/([^\r\n"“”]+\.md)/);
    if (!m) continue;
    const candidateName = m[1].trim().replace(/[“”"]/g, "");
    const candidateAbs = path.join(releasesDir, candidateName);
    if (fs.existsSync(candidateAbs)) return { file: candidateName, source: file };
  }
  return null;
}

function pickCanonicalFinal(releasesDir, candidates) {
  const pinned = resolveConfirmPinnedFile(releasesDir);
  if (pinned) {
    const hit = candidates.find((x) => x.name === pinned.file);
    if (hit) return { ...hit, pickedBy: `version-confirm:${pinned.source}` };
  }
  const finalNamed = candidates.find((x) => /终稿/.test(x.name));
  if (finalNamed) return { ...finalNamed, pickedBy: "name-priority:终稿" };
  if (candidates[0]) return { ...candidates[0], pickedBy: "mtime-latest" };
  return null;
}

function archiveExtraFinals(releasesDir, canonical, candidates, dryRun) {
  const extras = candidates.filter((x) => x.name !== canonical?.name);
  if (!extras.length) return { moved: [] };
  const archiveDir = path.join(releasesDir, "archive", makeStamp());
  const moved = [];
  for (const item of extras) {
    const dst = path.join(archiveDir, item.name);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(item.abs, dst);
    }
    moved.push({ from: item.abs, to: dst });
  }
  return { moved, archiveDir };
}

function ensureStateAndRegistry(bookRoot, canonical) {
  if (!canonical) return { state: null, releaseEntryCreated: false };
  let state = runFinalDraftStateMachine({ bookRoot, action: "status" });
  if (state.code === 0 && state.state?.currentState === "draft") {
    runFinalDraftStateMachine({
      bookRoot,
      action: "transition",
      to: "candidate",
      artifact: canonical.abs,
      reason: "release-governor 自动激活候选终稿",
      actor: "release-governor",
      force: false,
    });
    state = runFinalDraftStateMachine({
      bookRoot,
      action: "transition",
      to: "release",
      artifact: canonical.abs,
      reason: "release-governor 自动激活发布态",
      actor: "release-governor",
      force: false,
    });
  }

  const existing = listReleases(bookRoot, { status: RELEASE_STATUS.PUBLISHED, limit: 10 });
  if (existing.length > 0) {
    return { state, releaseEntryCreated: false };
  }
  createRelease(bookRoot, {
    title: path.basename(canonical.name, ".md"),
    version: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
    status: RELEASE_STATUS.PUBLISHED,
    channel: "release-governor",
    deliverablePaths: [canonical.abs],
    description: "自动补齐发布注册表条目",
  });
  return { state, releaseEntryCreated: true };
}

export function runReleaseGovernor({ bookRoot, strict = false, dryRun = false } = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root" };
  const releasesDir = path.join(bookRoot, "releases");
  if (!fs.existsSync(releasesDir)) return { code: 0, message: "skip: no releases dir", canonical: null, moved: [] };

  const candidates = listFinalCandidates(releasesDir);
  if (!candidates.length) {
    return { code: strict ? 1 : 0, message: strict ? "no final candidates" : "skip: no final files", canonical: null, moved: [] };
  }
  const cleanGate = runFinalManuscriptCleanGate({ bookRoot, strictNoTargets: false });
  if (cleanGate.code !== 0) {
    return {
      code: 1,
      message: "final-manuscript-clean-gate failed",
      canonical: null,
      moved: [],
      cleanGate,
    };
  }
  const canonical = pickCanonicalFinal(releasesDir, candidates);
  const archived = archiveExtraFinals(releasesDir, canonical, candidates, dryRun);
  const governance = dryRun ? { state: null, releaseEntryCreated: false } : ensureStateAndRegistry(bookRoot, canonical);

  const out = {
    code: 0,
    message: "release governance completed",
    releasesDir,
    canonical: canonical ? { name: canonical.name, path: canonical.abs, pickedBy: canonical.pickedBy } : null,
    moved: archived.moved || [],
    movedCount: (archived.moved || []).length,
    archiveDir: archived.archiveDir || null,
    finalDraftState: governance.state?.state?.currentState || null,
    releaseEntryCreated: governance.releaseEntryCreated,
  };

  try {
    const fbs = path.join(bookRoot, ".fbs");
    fs.mkdirSync(fbs, { recursive: true });
    fs.writeFileSync(path.join(fbs, "release-governor.json"), JSON.stringify({ updatedAt: new Date().toISOString(), ...out }, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = runReleaseGovernor(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[release-governor] ${out.message}`);
    if (out.canonical?.name) {
      console.log(`[release-governor] canonical: ${out.canonical.name} (${out.canonical.pickedBy})`);
    }
    if (out.movedCount > 0) {
      console.log(`[release-governor] archived old finals: ${out.movedCount}`);
    }
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("release-governor.mjs")) {
  main();
}
