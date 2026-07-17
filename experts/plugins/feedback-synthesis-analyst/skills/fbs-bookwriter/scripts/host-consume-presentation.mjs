#!/usr/bin/env node
import { pathToFileURL } from 'url';
import path from 'path';
import { launchPresentationPreview } from './launch-presentation-preview.mjs';
import { resolveLatestPresentationAccess } from './host-bridge.mjs';
import { applyPreviewFreshness, buildPresentationFreshnessToken } from './lib/presentation-runtime.mjs';


const DEFAULT_OPTIONS = {
  bookRoot: null,
  file: null,
  host: '127.0.0.1',
  port: 0,
  ttlMs: 10 * 60 * 1000,
  timeoutMs: 5000,
  healthcheckTimeoutMs: 1200,
  json: false,
  limit: 20,
  autoStartPreview: true,
  allowReadyRecordFallback: true,
};

export function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--book-root') options.bookRoot = argv[++i] || null;
    else if (arg === '--file') options.file = argv[++i] || null;
    else if (arg === '--host') options.host = argv[++i] || options.host;
    else if (arg === '--port') options.port = Number(argv[++i] || options.port);
    else if (arg === '--ttl-ms') options.ttlMs = Number(argv[++i] || options.ttlMs);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i] || options.timeoutMs);
    else if (arg === '--healthcheck-timeout-ms') options.healthcheckTimeoutMs = Number(argv[++i] || options.healthcheckTimeoutMs);
    else if (arg === '--limit') options.limit = Number(argv[++i] || options.limit);
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-auto-preview') options.autoStartPreview = false;
    else if (arg === '--no-ready-record-fallback') options.allowReadyRecordFallback = false;
  }

  return options;
}

function normalizeOptions(rawArgs = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...(rawArgs || {}),
  };
}

function materializePreviewAccess(access) {
  if (!access || access.mode !== 'preview_url' || !access.url || !access.path) return access;
  const freshnessToken = buildPresentationFreshnessToken(access.path);
  return {
    ...access,
    baseUrl: access.baseUrl || access.url,
    freshnessToken,
    url: applyPreviewFreshness(access.baseUrl || access.url, access.path, freshnessToken),
  };
}

function toHostAction(access, source) {

  if (!access?.path && !access?.url) return null;

  const tool = access.recommendedTool || (access.url ? 'preview_url' : 'open_result_view');
  const hostAction = tool === 'preview_url'
    ? (access.url ? { tool: 'preview_url', url: access.url } : null)
    : (access.path ? { tool: 'open_result_view', target_file: access.path } : null);

  return {
    source,
    tool,
    mode: access.mode || (access.url ? 'preview_url' : 'file'),
    label: access.label || null,
    path: access.path || null,
    format: access.format || 'file',
    url: access.url || null,
    hostAction,
  };
}


async function isPreviewReachable(url, timeoutMs) {
  if (!url) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function launchPreviewForHost(options, source) {
  const payload = await launchPresentationPreview({
    bookRoot: options.bookRoot,
    file: options.file,
    host: options.host,
    port: options.port,
    ttlMs: options.ttlMs,
    timeoutMs: options.timeoutMs,
    json: false,
    limit: options.limit,
  });
  const resolvedPayload = materializePreviewAccess(payload);

  return {
    ...resolvedPayload,
    ...(toHostAction(resolvedPayload, source) || {}),
    launchedPreview: resolvedPayload.mode === 'preview_url',
  };
}


function buildResolvedResult(access, source, extra = {}) {
  return {
    ...access,
    ...(toHostAction(access, source) || {}),
    launchedPreview: false,
    ...extra,
  };
}

/** 宿主集成提示：JSON 出口不等于已打开 UI（与 SKILL 结果展示章节一致） */
export function finalizePresentationResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    kpiSignal: {
      presentationBridgeSuccess: result.warning ? 0 : 1,
      usedPreviewUrl: result.tool === 'preview_url' ? 1 : 0,
      usedOpenResultView: result.tool === 'open_result_view' ? 1 : 0,
      previewAutoLaunched: result.launchedPreview ? 1 : 0,
    },
    hostIntegrationNote: {
      zh: '仅返回 JSON 不等于宿主已打开预览或文件；需由宿主调用 preview_url / open_result_view，或直接打开 path 指向的本地文件。',
      en: 'Returning JSON does not auto-open UI; host must invoke preview_url/open_result_view or open path locally.',
    },
  };
}

export async function consumePresentationForHost(rawArgs = parseArgs(process.argv)) {
  const options = normalizeOptions(rawArgs);

  if (options.file) {
    return finalizePresentationResult(await launchPreviewForHost(options, 'direct-file'));
  }

  const bookRoot = path.resolve(options.bookRoot || process.cwd());
  const resolved = resolveLatestPresentationAccess(bookRoot, {
    limit: options.limit,
    allowReadyRecordFallback: options.allowReadyRecordFallback,
  });

  if (!resolved && !options.autoStartPreview) {
    throw new Error(`未找到可供宿主消费的展示入口：${bookRoot}`);
  }

  const access = materializePreviewAccess(resolved?.access || null);

  if (access?.mode === 'preview_url' && access.url) {
    const reachable = await isPreviewReachable(access.url, options.healthcheckTimeoutMs);
    if (reachable) {
      return finalizePresentationResult(buildResolvedResult(access, resolved.source));
    }

    if (!options.autoStartPreview) {
      return finalizePresentationResult(
        buildResolvedResult(access, `${resolved.source}:stale`, {
          warning: 'preview_url_unreachable',
        }),
      );
    }
  }

  if (access?.mode === 'file') {
    return finalizePresentationResult(buildResolvedResult(access, resolved.source));
  }

  if (access?.mode === 'preview_plan' && !options.autoStartPreview) {
    return finalizePresentationResult(
      buildResolvedResult(access, resolved.source, {
        pendingPreviewLaunch: true,
      }),
    );
  }

  return finalizePresentationResult(
    await launchPreviewForHost({ ...options, bookRoot }, access ? `${resolved.source}:launch-preview` : 'launch-preview'),
  );
}

function printHumanReadable(result) {
  process.stdout.write(`Host presentation action ready: ${result.tool}\n`);
  if (result.label) process.stdout.write(`- Label: ${result.label}\n`);
  if (result.path) process.stdout.write(`- Path: ${result.path}\n`);
  if (result.url) process.stdout.write(`- URL: ${result.url}\n`);
  process.stdout.write(`- Source: ${result.source}\n`);
  if (result.launchedPreview) process.stdout.write('- Preview launch: started now\n');
  if (result.pendingPreviewLaunch) process.stdout.write('- Preview launch: pending\n');
  if (result.warning) process.stdout.write(`- Warning: ${result.warning}\n`);
}

export async function main() {
  const options = parseArgs(process.argv);
  try {
    const result = await consumePresentationForHost(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      printHumanReadable(result);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}
