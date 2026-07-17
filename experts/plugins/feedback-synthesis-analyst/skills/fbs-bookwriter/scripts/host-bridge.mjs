#!/usr/bin/env node
/**
 * FBS-宿主事件桥接模块
 * 支持 .fbs 正常模式与裸仓库 tmp 降级模式。
 */
import fs from 'fs';
import path from 'path';
import { resolveBridgeLogPath, resolvePresentationReadyPath } from './lib/presentation-runtime.mjs';

export const BRIDGE_LOG = 'host-bridge-events.jsonl';
export const PRESENTATION_READY_RECORD = 'presentation-ready.json';

export const EVENT_TYPES = {
  STAGE_CHANGE: 'fbs.stage.change',
  QUALITY_GATE: 'fbs.quality.gate',
  ORCHESTRATOR: 'fbs.orchestrator.event',
  AGENT_SPAWN: 'fbs.agent.spawn',
  AGENT_COMPLETE: 'fbs.agent.complete',
  S6_TRANSFORMATION: 'fbs.s6.transformation',
  RELEASE_STATE: 'fbs.release.state',
  PRESENTATION_READY: 'fbs.presentation.ready',
};

function normalizePresentationAccessPayload(rawAccess, target = null) {
  if (!rawAccess?.mode && !target?.path) return null;
  const access = { ...(rawAccess || {}) };
  access.path = target?.path || access.path || null;
  access.format = target?.format || access.format || 'file';
  access.recommendedTool = target?.recommendedTool || access.recommendedTool || (access.url ? 'preview_url' : 'open_result_view');
  access.label = target?.label
    || access.label
    || (target?.path ? path.basename(target.path) : access.path ? path.basename(access.path) : null);
  return access;
}

function normalizeFsPath(filePath) {
  if (!filePath) return '';
  try {
    return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  } catch {
    return String(filePath).replace(/\\/g, '/').toLowerCase();
  }
}

function isManagedPresentationPath(filePath) {
  const normalized = normalizeFsPath(filePath);
  return normalized.includes('/deliverables/') || normalized.includes('/releases/');
}

function isManagedPresentationTarget(target, payload = null) {
  if (!target?.path) return false;
  if (isManagedPresentationPath(target.path)) return true;
  if (target.channel === 'deliverables' || target.channel === 'releases') return true;
  const stage = target.stage || payload?.stage || null;
  return stage === 'S5' || stage === 'S6';
}

function isManagedPresentationAccess(access) {
  if (!access?.path) return false;
  return isManagedPresentationPath(access.path);
}

function isManagedPresentationEvent(eventOrPayload) {
  const payload = eventOrPayload?.payload || eventOrPayload;
  const target = resolvePresentationTarget(payload);
  return isManagedPresentationTarget(target, payload);
}


export function resolvePresentationTarget(eventOrPayload) {
  const payload = eventOrPayload?.payload || eventOrPayload;
  if (!payload || !payload.presentation) return null;
  const { primary, fallbacks = [] } = payload.presentation;
  if (primary?.path) return primary;
  return fallbacks.find((item) => item?.path) || null;
}

export function resolvePresentationPreview(eventOrPayload) {
  const target = resolvePresentationTarget(eventOrPayload);
  if (!target || !['html', 'md'].includes(target.format)) return null;
  if (target.preview?.rootDir && target.preview?.entry) return target.preview;
  return {
    mode: 'static-server',
    rootDir: path.dirname(target.path),
    entry: path.basename(target.path),
    route: `/${path.basename(target.path)}`,
    host: '127.0.0.1',
  };
}

export function resolvePresentationAccess(eventOrPayload) {
  const payload = eventOrPayload?.payload || eventOrPayload;
  if (!payload) return null;
  const target = resolvePresentationTarget(payload);
  if (payload.presentationAccess?.mode) {
    return normalizePresentationAccessPayload(payload.presentationAccess, target);
  }
  if (!target?.path) return null;
  if (['html', 'md'].includes(target.format) && target.recommendedTool === 'preview_url') {
    return normalizePresentationAccessPayload({
      mode: 'preview_plan',
      preview: resolvePresentationPreview(payload),
    }, target);
  }
  return normalizePresentationAccessPayload({ mode: 'file' }, target);
}

export function emitBridgeEvent(bookRoot, eventType, payload) {
  const target = resolveBridgeLogPath(bookRoot, BRIDGE_LOG);
  const event = {
    type: eventType,
    timestamp: new Date().toISOString(),
    runtimeMode: target.mode,
    payload,
  };
  fs.appendFileSync(target.filePath, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

export function toHostMessage(eventType, payload) {
  return {
    type: 'message',
    content: JSON.stringify({ eventType, payload }),
    summary: `[FBS] ${eventType}: ${payload.summary || 'no summary'}`,
  };
}

export function queryRecentEvents(bookRoot, limit = 10) {
  const target = resolveBridgeLogPath(bookRoot, BRIDGE_LOG);
  if (!fs.existsSync(target.filePath)) return [];
  const raw = fs.readFileSync(target.filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').slice(-limit).map((line) => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

export function queryLatestEventByType(bookRoot, eventType, limit = 20) {
  const events = queryRecentEvents(bookRoot, limit);
  return [...events].reverse().find((event) => event?.type === eventType) || null;
}

export function queryLatestPresentationEvent(bookRoot, limit = 20) {
  const events = queryRecentEvents(bookRoot, limit);
  return [...events].reverse().find((event) => isManagedPresentationEvent(event)) || null;
}


export function readPresentationReadyRecord(bookRoot) {
  const target = resolvePresentationReadyPath(bookRoot, PRESENTATION_READY_RECORD);
  if (!fs.existsSync(target.filePath)) return null;
  try {
    const raw = fs.readFileSync(target.filePath, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function resolveLatestPresentationAccess(bookRoot, options = {}) {
  const limit = Number(options.limit) || 20;
  const allowReadyRecordFallback = options.allowReadyRecordFallback !== false;

  const readyEvent = queryLatestEventByType(bookRoot, EVENT_TYPES.PRESENTATION_READY, limit);
  const readyAccess = resolvePresentationAccess(readyEvent);
  if (readyAccess && (isManagedPresentationEvent(readyEvent) || isManagedPresentationAccess(readyAccess))) {
    return { source: 'bridge-ready-event', event: readyEvent, access: readyAccess };
  }

  if (allowReadyRecordFallback) {
    const readyRecord = readPresentationReadyRecord(bookRoot);
    const readyRecordAccess = normalizePresentationAccessPayload(readyRecord);
    if (readyRecordAccess && isManagedPresentationAccess(readyRecordAccess)) {
      return { source: 'presentation-ready-record', readyRecord, access: readyRecordAccess };
    }
  }

  const latestPresentationEvent = queryLatestPresentationEvent(bookRoot, limit);
  const latestAccess = resolvePresentationAccess(latestPresentationEvent);
  if (!latestAccess) return null;
  return { source: 'bridge-plan-event', event: latestPresentationEvent, access: latestAccess };
}


if (process.argv[1] && process.argv[1].endsWith('host-bridge.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === 'query') {
    const bookRoot = args[1] || process.cwd();
    const limit = Number(args[2]) || 10;
    console.log(JSON.stringify(queryRecentEvents(bookRoot, limit), null, 2));
  } else if (args[0] === 'presentation') {
    const bookRoot = args[1] || process.cwd();
    const limit = Number(args[2]) || 20;
    console.log(JSON.stringify(resolveLatestPresentationAccess(bookRoot, { limit }), null, 2));
  } else {
    console.log('用法: node host-bridge.mjs <query|presentation> [bookRoot] [limit]');
  }
}
