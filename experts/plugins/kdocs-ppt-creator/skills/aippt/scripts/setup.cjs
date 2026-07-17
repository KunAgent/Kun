#!/usr/bin/env node
// kdocs-cli installer — cross-platform Node.js script.
// Requires Node.js >= 18 (uses native fetch).
//
// Usage:
//   node scripts/setup.js
//
// Environment variables (all optional):
//   KDOCS_CLI_VERSION   — version to install (default: read from SKILL.md)
//   KDOCS_CLI_CDN       — CDN base URL override
//   KDOCS_CLI_DIR       — install directory override

'use strict';

const { createHash } = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const CDN_BASE = process.env.KDOCS_CLI_CDN || 'https://wpsai.wpscdn.cn/skillhub/pro';
const BIN_NAME = 'kdocs-cli';

function say(msg) { console.log(`  ${msg}`); }
function err(msg) { console.error(`  \u274C ${msg}`); process.exit(1); }

function detectPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  const osMap = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const osName = osMap[platform];
  const archName = archMap[arch];
  if (!osName) err(`Unsupported OS: ${platform}`);
  if (!archName) err(`Unsupported architecture: ${arch}`);
  return { os: osName, arch: archName };
}

function defaultInstallDir(osName) {
  if (process.env.KDOCS_CLI_DIR) return process.env.KDOCS_CLI_DIR;
  if (osName === 'windows') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'kdocs-cli');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

function resolveVersion() {
  if (process.env.KDOCS_CLI_VERSION) return process.env.KDOCS_CLI_VERSION;
  const scriptDir = __dirname;
  const candidates = [
    path.join(scriptDir, '..', 'SKILL.md'),
    path.join(scriptDir, '..', '..', 'SKILL.md'),
    path.resolve('SKILL.md'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(/^version:\s*"?([^"\s]+)"?\s*$/m);
      if (match) return match[1];
    }
  }
  err('Cannot determine version. Set KDOCS_CLI_VERSION explicitly.');
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function checkExisting(targetVersion) {
  try {
    const existingVer = execSync(`${BIN_NAME} version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const existingPath = execSync(
      os.platform() === 'win32' ? `where ${BIN_NAME}` : `command -v ${BIN_NAME}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().split(/\r?\n/)[0];

    if (existingVer === targetVersion) {
      say(`${BIN_NAME} v${targetVersion} is already installed at ${existingPath}`);
      say(`Use '${BIN_NAME} upgrade' to check for updates.`);
      process.exit(0);
    }
    if (compareVersions(existingVer, targetVersion) >= 0) {
      say(`Installed ${BIN_NAME} v${existingVer} >= target v${targetVersion}, skipping.`);
      say(`Use '${BIN_NAME} upgrade' to manage versions.`);
      process.exit(0);
    }
    say(`Found existing ${BIN_NAME} v${existingVer} at ${existingPath}`);
    say(`Will upgrade to v${targetVersion}`);
  } catch {
    // not installed — proceed
  }
}

async function download(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const fileStream = fs.createWriteStream(dest);
  await pipeline(resp.body, fileStream);
}

async function verifyChecksum(archivePath, archiveName, checksumsUrl, tmpDir) {
  try {
    const csPath = path.join(tmpDir, 'checksums.txt');
    await download(checksumsUrl, csPath);
    const lines = fs.readFileSync(csPath, 'utf8').split('\n');
    const match = lines.find(l => l.includes(archiveName));
    if (!match) { say('\u26A0 Archive not in checksums.txt; skipping verification'); return; }
    const expected = match.split(/\s+/)[0].toLowerCase();
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(archivePath));
    const actual = hash.digest('hex');
    if (actual !== expected) err(`SHA256 mismatch! Expected ${expected}, got ${actual}.`);
    say('SHA256 verified \u2713');
  } catch (e) {
    if (e.message.includes('SHA256 mismatch')) throw e;
    say('\u26A0 Could not verify checksum; skipping');
  }
}

function extract(archivePath, destDir, osName) {
  fs.mkdirSync(destDir, { recursive: true });
  if (osName === 'windows') {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe' });
  } else {
    execSync(`tar xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
  }
}

function findBinary(dir, osName) {
  const target = osName === 'windows' ? `${BIN_NAME}.exe` : BIN_NAME;
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && entry.name === target) {
      return path.join(entry.parentPath || entry.path, entry.name);
    }
  }
  return null;
}

async function main() {
  if (typeof globalThis.fetch !== 'function') {
    err('Node.js >= 18 required (native fetch). Current: ' + process.version);
  }

  const { os: osName, arch } = detectPlatform();
  const version = resolveVersion();
  const installDir = defaultInstallDir(osName);

  checkExisting(version);

  const ext = osName === 'windows' ? '.zip' : '.tar.gz';
  const archiveName = `${BIN_NAME}-${version}-${osName}-${arch}${ext}`;
  const downloadUrl = `${CDN_BASE}/v${version}/releases/${archiveName}`;
  const checksumsUrl = `${CDN_BASE}/v${version}/releases/checksums.txt`;

  say(`Installing ${BIN_NAME} v${version} (${osName}/${arch})...`);
  say(`Target: ${path.join(installDir, osName === 'windows' ? `${BIN_NAME}.exe` : BIN_NAME)}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdocs-cli-install-'));
  try {
    const archivePath = path.join(tmpDir, archiveName);

    say(`Downloading ${archiveName}...`);
    await download(downloadUrl, archivePath);
    await verifyChecksum(archivePath, archiveName, checksumsUrl, tmpDir);

    say('Extracting...');
    const extractDir = path.join(tmpDir, 'extracted');
    extract(archivePath, extractDir, osName);

    const binFile = findBinary(extractDir, osName);
    if (!binFile) err('Binary not found in the downloaded archive.');

    fs.mkdirSync(installDir, { recursive: true });
    const destBin = path.join(installDir, osName === 'windows' ? `${BIN_NAME}.exe` : BIN_NAME);
    fs.copyFileSync(binFile, destBin);
    if (osName !== 'windows') fs.chmodSync(destBin, 0o755);

    // Record install source for analytics (X-Request-Source header)
    fs.writeFileSync(path.join(installDir, '.source'), 'aippt');

    say(`\u2705 Installed: ${destBin}`);

    const envPath = process.env.PATH || '';
    if (!envPath.split(path.delimiter).includes(installDir)) {
      say('');
      say(`\u26A0 ${installDir} is not in your PATH.`);
      if (osName === 'windows') {
        say(`  Run: [Environment]::SetEnvironmentVariable("PATH", "${installDir};$env:PATH", "User")`);
      } else {
        say(`  Add to ~/.bashrc or ~/.zshrc:`);
        say(`    export PATH="${installDir}:$PATH"`);
      }
    }

    say('');
    say(`\uD83C\uDF89 ${BIN_NAME} v${version} ready!`);
    say(`  Run: ${BIN_NAME} version`);
    say(`  Upgrade later: ${BIN_NAME} upgrade`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(e => { err(e.message); });
