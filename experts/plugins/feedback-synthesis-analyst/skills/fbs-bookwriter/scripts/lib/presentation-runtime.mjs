import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

function stableKey(bookRoot) {
  return crypto.createHash('sha1').update(String(bookRoot || process.cwd())).digest('hex').slice(0, 12);
}

export function resolvePresentationRuntimeBase(bookRoot) {
  const root = path.resolve(bookRoot || process.cwd());
  const fbsDir = path.join(root, '.fbs');
  if (fs.existsSync(fbsDir)) {
    return { root, mode: 'fbs', baseDir: fbsDir };
  }
  const baseDir = path.join(os.tmpdir(), 'fbs-preview', stableKey(root));
  fs.mkdirSync(baseDir, { recursive: true });
  return { root, mode: 'tmp', baseDir };
}

export function resolvePreviewRuntimeDir(bookRoot) {
  const runtime = resolvePresentationRuntimeBase(bookRoot);
  const dir = path.join(runtime.baseDir, 'preview-runtime');
  fs.mkdirSync(dir, { recursive: true });
  return { ...runtime, dir };
}

export function resolveBridgeLogPath(bookRoot, logFileName = 'host-bridge-events.jsonl') {
  const runtime = resolvePresentationRuntimeBase(bookRoot);
  fs.mkdirSync(runtime.baseDir, { recursive: true });
  return { ...runtime, filePath: path.join(runtime.baseDir, logFileName) };
}

export function resolvePresentationReadyPath(bookRoot, fileName = 'presentation-ready.json') {
  const runtime = resolvePresentationRuntimeBase(bookRoot);
  fs.mkdirSync(runtime.baseDir, { recursive: true });
  return { ...runtime, filePath: path.join(runtime.baseDir, fileName) };
}

export function readPresentationFreshness(filePath) {
  if (!filePath) return null;
  try {
    const resolvedPath = path.resolve(filePath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return null;
    return {
      path: resolvedPath,
      mtimeMs: Math.trunc(stat.mtimeMs),
      size: Number(stat.size || 0),
    };
  } catch {
    return null;
  }
}

export function buildPresentationFreshnessToken(filePath) {
  const freshness = readPresentationFreshness(filePath);
  if (!freshness) return null;
  return `${freshness.mtimeMs.toString(36)}-${freshness.size.toString(36)}`;
}

export function applyPreviewFreshness(url, filePath, explicitToken = null) {
  if (!url) return url;
  const freshnessToken = explicitToken || buildPresentationFreshnessToken(filePath);
  if (!freshnessToken) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('v', freshnessToken);
    return parsed.toString();
  } catch {
    return url;
  }
}

