#!/usr/bin/env node

/**
 * Verify that the solo-design skill directories for macos / linux / windows
 * are byte-identical (per-file hash comparison).
 *
 * Usage: node check-skill-sync.mjs
 *   (run from anywhere; platform roots are resolved relative to this script)
 *
 * Exit codes: 0 = all copies in sync, 1 = drift detected
 *
 * Maintainer note: any edit to the skill must be applied to the macos copy
 * first, then mirrored to linux/windows. Run this script before committing.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// SCRIPT_DIR = .../builtin/{platform}/design/default/skills/solo-design/script
const SKILL_DIR = path.dirname(SCRIPT_DIR);
// up: skills -> default -> design -> {platform} -> builtin
const BUILTIN_DIR = path.resolve(SKILL_DIR, '..', '..', '..', '..', '..');
const PLATFORMS = ['macos', 'linux', 'windows'];
const REL_SKILL_PATH = path.join('design', 'default', 'skills', 'solo-design');
const IGNORED = new Set(['.DS_Store']);

function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const roots = {};
for (const platform of PLATFORMS) {
  const root = path.join(BUILTIN_DIR, platform, REL_SKILL_PATH);
  if (!fs.existsSync(root)) {
    console.error(`[FAIL] missing platform copy: ${root}`);
    process.exit(1);
  }
  roots[platform] = root;
}

const baseline = 'macos';
const baselineFiles = listFiles(roots[baseline]);
let drift = 0;

for (const platform of PLATFORMS.filter(p => p !== baseline)) {
  const files = listFiles(roots[platform]);
  const baseSet = new Set(baselineFiles);
  const otherSet = new Set(files);

  for (const f of baselineFiles) {
    if (!otherSet.has(f)) {
      console.error(`[DRIFT] ${platform}: missing file ${f}`);
      drift++;
    }
  }
  for (const f of files) {
    if (!baseSet.has(f)) {
      console.error(`[DRIFT] ${platform}: extra file ${f}`);
      drift++;
    }
  }
  for (const f of baselineFiles) {
    if (!otherSet.has(f)) continue;
    const a = hashFile(path.join(roots[baseline], f));
    const b = hashFile(path.join(roots[platform], f));
    if (a !== b) {
      console.error(`[DRIFT] ${platform}: content differs from ${baseline}: ${f}`);
      drift++;
    }
  }
}

if (drift > 0) {
  console.error(`\nSync check FAILED: ${drift} drift issue(s). Mirror the macos copy to the drifted platform(s).`);
  process.exit(1);
}
console.log(`Sync check passed: ${PLATFORMS.join(' / ')} copies are identical (${baselineFiles.length} files).`);
