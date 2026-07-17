#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  emitBridgeEvent,
  EVENT_TYPES,
  queryLatestPresentationEvent,
  resolvePresentationPreview,
  resolvePresentationTarget,
} from './host-bridge.mjs';
import {
  applyPreviewFreshness,
  buildPresentationFreshnessToken,
  resolvePresentationReadyPath,
  resolvePreviewRuntimeDir,
} from './lib/presentation-runtime.mjs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREVIEW_SERVER_SCRIPT = path.join(__dirname, 'presentation-preview-server.mjs');

function parseArgs(argv) {
  const options = {
    bookRoot: null,
    file: null,
    host: '127.0.0.1',
    port: 0,
    ttlMs: 10 * 60 * 1000,
    timeoutMs: 5000,
    json: false,
    limit: 20,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--book-root') options.bookRoot = argv[++i] || null;
    else if (arg === '--file') options.file = argv[++i] || null;
    else if (arg === '--host') options.host = argv[++i] || options.host;
    else if (arg === '--port') options.port = Number(argv[++i] || options.port);
    else if (arg === '--ttl-ms') options.ttlMs = Number(argv[++i] || options.ttlMs);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i] || options.timeoutMs);
    else if (arg === '--limit') options.limit = Number(argv[++i] || options.limit);
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function createStateFilePath(baseDir) {
  const runtime = resolvePreviewRuntimeDir(baseDir || os.tmpdir());
  return path.join(runtime.dir, `presentation-preview-${Date.now()}-${process.pid}.json`);
}

function createReadyRecordPath(baseDir) {
  return resolvePresentationReadyPath(baseDir).filePath;
}

function hasBridgeStateDir() {
  return true;
}

function resolveDirectFileTarget(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`展示文件不存在：${absolutePath}`);
  }
  const format = path.extname(absolutePath).slice(1).toLowerCase() || 'file';
  const needsPreview = ['html', 'md'].includes(format);
  const preview = needsPreview ? {
    mode: 'static-server',
    rootDir: path.dirname(absolutePath),
    entry: path.basename(absolutePath),
    route: `/${path.basename(absolutePath)}`,
    host: '127.0.0.1',
  } : null;

  return {
    target: {
      path: absolutePath,
      format,
      recommendedTool: needsPreview ? 'preview_url' : 'open_result_view',
      label: `${path.basename(absolutePath)} 展示目标`,
      preview,
    },
    preview,
    bookRoot: path.dirname(absolutePath),
  };
}

function resolveLatestPresentation(options) {
  if (options.file) return resolveDirectFileTarget(options.file);
  const bookRoot = path.resolve(options.bookRoot || process.cwd());
  const event = queryLatestPresentationEvent(bookRoot, options.limit);
  if (!event) throw new Error(`未找到可展示结果：${bookRoot}`);
  const target = resolvePresentationTarget(event);
  const preview = resolvePresentationPreview(event);
  return { event, target, preview, bookRoot };
}

async function waitForStateFile(stateFile, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`预览服务启动超时：${stateFile}`);
}

function writeReadyRecord(recordPath, payload) {
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function createPresentationEnvelope(resolved, target) {
  const sourcePresentation = resolved.event?.payload?.presentation;
  return {
    primary: {
      ...(sourcePresentation?.primary || {}),
      ...target,
      preview: target.preview || sourcePresentation?.primary?.preview || resolved.preview || null,
    },
    fallbacks: Array.isArray(sourcePresentation?.fallbacks) ? sourcePresentation.fallbacks : [],
    guidance: sourcePresentation?.guidance,
  };
}

function isManagedPresentationPath(targetPath) {
  if (!targetPath) return false;
  const normalized = path.resolve(targetPath).replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/deliverables/') || normalized.includes('/releases/');
}

function shouldPersistPresentationReady(resolved, payload) {
  if (resolved?.event) return true;
  return isManagedPresentationPath(payload?.path || resolved?.target?.path);
}

function persistPresentationReady(baseDir, resolved, payload) {
  if (!hasBridgeStateDir(baseDir) || !shouldPersistPresentationReady(resolved, payload)) return null;
  writeReadyRecord(createReadyRecordPath(baseDir), payload);
  return emitBridgeEvent(baseDir, EVENT_TYPES.PRESENTATION_READY, {
    stage: resolved.event?.payload?.stage || null,
    chapterId: resolved.event?.payload?.chapterId || null,
    summary: payload.mode === 'preview_url'
      ? `${payload.label || path.basename(payload.path)} 预览已就绪`
      : `${payload.label || path.basename(payload.path)} 展示目标已就绪`,
    sourceEventType: resolved.event?.type || null,
    presentation: createPresentationEnvelope(resolved, resolved.target),
    presentationAccess: payload,
  });
}


export async function launchPresentationPreview(rawArgs = parseArgs(process.argv)) {
  const options = rawArgs.bookRoot || rawArgs.file ? rawArgs : parseArgs(process.argv);
  const resolved = resolveLatestPresentation(options);
  const { target, preview, bookRoot } = resolved;
  if (!target?.path) throw new Error('未解析到展示目标');

  const needsPreview = ['html', 'md'].includes(target.format) && target.recommendedTool === 'preview_url';
  if (!needsPreview) {
    const payload = {
      mode: 'file',
      path: target.path,
      format: target.format || 'file',
      recommendedTool: target.recommendedTool || 'open_result_view',
      label: target.label || path.basename(target.path),
    };
    persistPresentationReady(bookRoot, resolved, payload);
    if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
    else process.stdout.write(`Presentation target ready: ${payload.path}\n`);
    return payload;
  }

  const previewInfo = preview || target.preview;
  if (!previewInfo?.rootDir || !previewInfo?.entry) {
    throw new Error(`展示目标缺少预览配置：${target.path}`);
  }

  const baseDir = bookRoot || previewInfo.rootDir || os.tmpdir();
  const stateFile = createStateFilePath(baseDir);
  const child = spawn(
    process.execPath,
    [
      PREVIEW_SERVER_SCRIPT,
      '--file', target.path,
      '--host', options.host,
      '--port', String(options.port),
      '--ttl-ms', String(options.ttlMs),
      '--state-file', stateFile,
      '--json',
    ],
    {
      cwd: bookRoot || process.cwd(),
      detached: true,
      stdio: 'ignore',
    }
  );
  child.unref();

  const serverPayload = await waitForStateFile(stateFile, options.timeoutMs);
  fs.rmSync(stateFile, { force: true });

  const freshnessToken = buildPresentationFreshnessToken(target.path);
  const payload = {
    mode: 'preview_url',
    url: applyPreviewFreshness(serverPayload.url, target.path, freshnessToken),
    baseUrl: serverPayload.url,
    freshnessToken,
    path: target.path,
    format: target.format,
    recommendedTool: 'preview_url',
    label: target.label || path.basename(target.path),
    rootDir: serverPayload.rootDir,
    entry: serverPayload.entry,
    route: serverPayload.route,
    ttlMs: serverPayload.ttlMs,
    serverPid: serverPayload.pid,
    ...(typeof serverPayload.requestedPort === 'number' ? { requestedPort: serverPayload.requestedPort } : {}),
    ...(typeof serverPayload.listeningPort === 'number' ? { listeningPort: serverPayload.listeningPort } : {}),
    ...(serverPayload.portConflictResolved ? { portConflictResolved: true } : {}),
  };

  persistPresentationReady(bookRoot || previewInfo.rootDir, resolved, payload);

  if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else process.stdout.write(`Presentation preview ready: ${payload.url}\n`);
  return payload;
}

export async function main() {
  try {
    await launchPresentationPreview();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}
