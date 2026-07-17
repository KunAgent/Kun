#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

function parseArgs(argv) {
  const o = {
    root: process.cwd(),
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = argv[++i];
    else if (a === "--out") o.out = argv[++i];
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  const lockPath = path.join(root, "package-lock.json");

  if (!fs.existsSync(lockPath)) {
    console.error(`未找到 package-lock.json: ${lockPath}`);
    process.exit(2);
  }

  const text = fs.readFileSync(lockPath, "utf8");
  const json = JSON.parse(text);
  const pkgs = json.packages && typeof json.packages === "object" ? Object.keys(json.packages).length : 0;
  const deps = json.dependencies && typeof json.dependencies === "object" ? Object.keys(json.dependencies).length : 0;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const sizeKb = Number((fs.statSync(lockPath).size / 1024).toFixed(1));

  const summary = {
    generatedAt: new Date().toISOString(),
    lockfile: "package-lock.json",
    lockfileVersion: json.lockfileVersion,
    packageCount: pkgs,
    dependencyCount: deps,
    sizeKb,
    contentHash16: hash,
  };

  console.log(JSON.stringify(summary, null, 2));

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(root, ".fbs", "lockfile-summary.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`已写出: ${outPath}`);
}

main();
