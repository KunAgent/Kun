import fs from 'fs';
import path from 'path';

export function resolveFbsDir(bookRoot) {
  return path.join(path.resolve(bookRoot), '.fbs');
}

export function resolveGovernanceDir(bookRoot) {
  return path.join(resolveFbsDir(bookRoot), 'governance');
}

export function ensureGovernanceDir(bookRoot) {
  const dir = resolveGovernanceDir(bookRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function governanceArtifactPath(bookRoot, filename) {
  return path.join(resolveGovernanceDir(bookRoot), filename);
}

export function firstExistingPath(paths = []) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

