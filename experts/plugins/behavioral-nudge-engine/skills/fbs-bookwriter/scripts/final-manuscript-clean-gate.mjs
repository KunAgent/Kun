#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { globSync } from "glob";

const FORBIDDEN_PATTERNS = [
  { id: "pending-mat-bracket", re: /\[待核实-MAT-[^\]\r\n]+\]/gi },
  { id: "pending-mat-plain", re: /待核实-MAT-(?!XXX\b)[A-Za-z0-9-]+/gi },
  { id: "mat-todo-suffix", re: /MAT-[A-Za-z0-9-]+（待补充）/gi },
  { id: "discarded-tag", re: /\[DISCARDED-[^\]\r\n]{1,300}\]/gi },
  { id: "malformed-pending-line", re: /^\s*-\s*`{0,2}\s*`{0,2}\s*[：:]\s*待核实[^\r\n]*$/gim },
];

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    strictNoTargets: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--strict-no-targets") out.strictNoTargets = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function listFinalManuscriptTargets(bookRoot) {
  const candidates = new Set();
  for (const pattern of ["releases/**/*.md", "deliverables/**/*.md"]) {
    for (const abs of globSync(pattern, { cwd: bookRoot, absolute: true, nodir: true })) {
      const name = path.basename(abs);
      if (/(全稿|终稿|终审)/.test(name)) candidates.add(abs);
    }
  }
  return [...candidates];
}

function collectViolations(text) {
  const violations = [];
  for (const rule of FORBIDDEN_PATTERNS) {
    const matches = String(text).match(rule.re);
    if (!matches || matches.length === 0) continue;
    violations.push({ rule: rule.id, count: matches.length, sample: String(matches[0]).slice(0, 120) });
  }
  return violations;
}

function writeSnapshot(bookRoot, payload) {
  const gatesDir = path.join(bookRoot, ".fbs", "gates");
  fs.mkdirSync(gatesDir, { recursive: true });
  fs.writeFileSync(
    path.join(gatesDir, "final-manuscript-clean-gate.last.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
}

export function runFinalManuscriptCleanGate({ bookRoot, strictNoTargets = false } = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root", targets: [], violations: [] };
  const targets = listFinalManuscriptTargets(bookRoot);
  if (targets.length === 0) {
    const code = strictNoTargets ? 1 : 0;
    const out = {
      code,
      message: strictNoTargets ? "no final manuscript targets" : "skip: no final manuscript targets",
      targets,
      violations: [],
    };
    try {
      writeSnapshot(bookRoot, { generatedAt: new Date().toISOString(), ...out });
    } catch {
      // ignore
    }
    return out;
  }

  const violations = [];
  for (const file of targets) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hit = collectViolations(text);
    if (hit.length === 0) continue;
    violations.push({ file, violations: hit });
  }

  const blocked = violations.length > 0;
  const out = {
    code: blocked ? 1 : 0,
    message: blocked
      ? "forbidden writing-process markers found in final manuscripts"
      : "final manuscripts are clean",
    targets,
    violations,
  };
  try {
    writeSnapshot(bookRoot, { generatedAt: new Date().toISOString(), ...out });
  } catch {
    // ignore
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = runFinalManuscriptCleanGate(args);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[final-manuscript-clean-gate] ${out.message}`);
    console.log(
      `[final-manuscript-clean-gate] targets=${out.targets.length} filesWithViolations=${out.violations.length}`,
    );
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("final-manuscript-clean-gate.mjs")) {
  main();
}
