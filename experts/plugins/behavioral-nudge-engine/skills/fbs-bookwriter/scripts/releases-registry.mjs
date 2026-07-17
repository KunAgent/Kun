#!/usr/bin/env node
/**
 * FBS-BookWriter 导出注册表（Releases Registry）
 *
 * 管理 releases/ 目录下的 *-release.json 发布清单：
 * - 创建/更新/读取发布条目
 * - 按版本/时间/状态查询
 * - 与 deliverables/ 的产出物关联
 * - 提供给上架脚本、host-bridge、Inspector 消费
 *
 * 用法：
 *   node scripts/releases-registry.mjs list   <bookRoot>
 *   node scripts/releases-registry.mjs create <bookRoot> --title "书名" --version "1.0.0"
 *   node scripts/releases-registry.mjs get    <bookRoot> --id <releaseId>
 *   node scripts/releases-registry.mjs update <bookRoot> --id <releaseId> --status published
 *   node scripts/releases-registry.mjs link   <bookRoot> --id <releaseId> --file <deliverablePath>
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RELEASES_DIRNAME = 'releases';
export const RELEASE_FILE_SUFFIX = '-release.json';

/**
 * 发布条目状态枚举
 */
export const RELEASE_STATUS = {
  DRAFT: 'draft',
  STAGED: 'staged',
  PUBLISHED: 'published',
  FEEDBACK_RECEIVED: 'feedback_received',
  REVISING: 'revising',
  ARCHIVED: 'archived',
};

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function releasesDir(bookRoot) {
  return path.join(path.resolve(bookRoot), RELEASES_DIRNAME);
}

function releaseFilePath(bookRoot, releaseId) {
  return path.join(releasesDir(bookRoot), `${releaseId}${RELEASE_FILE_SUFFIX}`);
}

function ensureReleasesDir(bookRoot) {
  fs.mkdirSync(releasesDir(bookRoot), { recursive: true });
}

function generateReleaseId(title, version) {
  const slug = String(title || 'release')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${slug}-${version || 'v1'}-${ts}-${rand}`;
}

function safeReadRelease(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── 核心 API ─────────────────────────────────────────────────────────────────

/**
 * 列出所有发布条目
 * @param {string} bookRoot
 * @param {object} options - { status, sortBy, limit }
 * @returns {object[]} releases
 */
export function listReleases(bookRoot, options = {}) {
  ensureReleasesDir(bookRoot);
  const dir = releasesDir(bookRoot);

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(RELEASE_FILE_SUFFIX));

  let releases = files
    .map(f => safeReadRelease(path.join(dir, f)))
    .filter(Boolean);

  // 过滤
  if (options.status) {
    releases = releases.filter(r => r.status === options.status);
  }

  // 排序
  const sortBy = options.sortBy || 'createdAt';
  releases.sort((a, b) => {
    if (sortBy === 'createdAt') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sortBy === 'version') return String(b.version).localeCompare(String(a.version));
    return 0;
  });

  // 限制
  if (options.limit > 0) {
    releases = releases.slice(0, options.limit);
  }

  return releases;
}

/**
 * 获取单个发布条目
 * @param {string} bookRoot
 * @param {string} releaseId
 * @returns {object|null}
 */
export function getRelease(bookRoot, releaseId) {
  return safeReadRelease(releaseFilePath(bookRoot, releaseId));
}

/**
 * 创建发布条目
 * @param {string} bookRoot
 * @param {object} fields - { title, version, description, format, deliverablePaths, tags, channel, meta }
 * @returns {object} release
 */
export function createRelease(bookRoot, fields = {}) {
  ensureReleasesDir(bookRoot);

  const releaseId = generateReleaseId(fields.title, fields.version);
  const now = new Date().toISOString();
  const initialStatus = fields.status || RELEASE_STATUS.DRAFT;

  const release = {
    id: releaseId,
    version: fields.version || '1.0.0',
    title: fields.title || '未命名作品',
    description: fields.description || '',
    status: initialStatus,
    format: fields.format || 'markdown',
    channel: fields.channel || 'default',
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    deliverables: (fields.deliverablePaths || []).map(p => ({
      path: path.resolve(p),
      addedAt: now,
    })),
    meta: fields.meta || {},
    createdAt: now,
    updatedAt: now,
    publishedAt: initialStatus === RELEASE_STATUS.PUBLISHED ? now : null,
    archivedAt: initialStatus === RELEASE_STATUS.ARCHIVED ? now : null,
  };

  fs.writeFileSync(
    releaseFilePath(bookRoot, releaseId),
    JSON.stringify(release, null, 2) + '\n',
    'utf8'
  );

  return release;
}

/**
 * 更新发布条目
 * @param {string} bookRoot
 * @param {string} releaseId
 * @param {object} updates - 可更新字段
 * @returns {object|null} updated release
 */
export function updateRelease(bookRoot, releaseId, updates = {}) {
  const existing = getRelease(bookRoot, releaseId);
  if (!existing) return null;

  const now = new Date().toISOString();

  // 状态转换时记录时间戳
  if (updates.status && updates.status !== existing.status) {
    if (updates.status === RELEASE_STATUS.PUBLISHED) {
      updates.publishedAt = now;
    } else if (updates.status === RELEASE_STATUS.ARCHIVED) {
      updates.archivedAt = now;
    }
  }

  const updated = {
    ...existing,
    ...updates,
    id: existing.id, // 不允许覆盖 id
    createdAt: existing.createdAt, // 不允许覆盖创建时间
    updatedAt: now,
  };

  fs.writeFileSync(
    releaseFilePath(bookRoot, releaseId),
    JSON.stringify(updated, null, 2) + '\n',
    'utf8'
  );

  return updated;
}

/**
 * 关联 deliverable 文件到发布条目
 * @param {string} bookRoot
 * @param {string} releaseId
 * @param {string} deliverablePath
 * @returns {object|null}
 */
export function linkDeliverable(bookRoot, releaseId, deliverablePath) {
  const release = getRelease(bookRoot, releaseId);
  if (!release) return null;

  const absPath = path.resolve(deliverablePath);
  const alreadyLinked = release.deliverables?.some(d => d.path === absPath);

  if (alreadyLinked) return release;

  const deliverables = [
    ...(release.deliverables || []),
    { path: absPath, addedAt: new Date().toISOString() },
  ];

  return updateRelease(bookRoot, releaseId, { deliverables });
}

/**
 * 删除发布条目（软删除为归档，硬删除需传 force=true）
 * @param {string} bookRoot
 * @param {string} releaseId
 * @param {boolean} force
 * @returns {boolean}
 */
export function deleteRelease(bookRoot, releaseId, force = false) {
  const filePath = releaseFilePath(bookRoot, releaseId);
  if (!fs.existsSync(filePath)) return false;

  if (force) {
    fs.unlinkSync(filePath);
    return true;
  }

  // 软删除 → 归档
  updateRelease(bookRoot, releaseId, { status: RELEASE_STATUS.ARCHIVED });
  return true;
}

/**
 * 获取最新发布条目（按 publishedAt 或 createdAt）
 * @param {string} bookRoot
 * @returns {object|null}
 */
export function getLatestRelease(bookRoot) {
  const releases = listReleases(bookRoot, { sortBy: 'createdAt' });
  return releases[0] || null;
}

/**
 * 生成注册表摘要（供 workspace-manifest / Inspector 消费）
 * @param {string} bookRoot
 * @returns {object}
 */
export function getRegistrySummary(bookRoot) {
  const all = listReleases(bookRoot);
  const byStatus = {};
  for (const s of Object.values(RELEASE_STATUS)) {
    byStatus[s] = all.filter(r => r.status === s).length;
  }
  return {
    total: all.length,
    byStatus,
    latest: all[0] ? { id: all[0].id, title: all[0].title, version: all[0].version, status: all[0].status, createdAt: all[0].createdAt } : null,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags[argv[i].slice(2)] = argv[++i];
      } else if (argv[i].startsWith('--')) {
        flags[argv[i].slice(2)] = true;
      }
    }
    return flags;
  }

  const [action, bookRoot = process.cwd()] = args;
  const flags = parseFlags(args.slice(2));

  if (!action || action === '--help') {
    console.log(`
导出注册表工具

用法:
  node releases-registry.mjs list   <bookRoot>                               列出所有发布
  node releases-registry.mjs create <bookRoot> --title <标题> --version <版本>  创建发布
  node releases-registry.mjs get    <bookRoot> --id <releaseId>              获取发布
  node releases-registry.mjs update <bookRoot> --id <releaseId> --status <s> 更新发布
  node releases-registry.mjs link   <bookRoot> --id <releaseId> --file <路径>  关联文件
  node releases-registry.mjs delete <bookRoot> --id <releaseId>              归档发布
  node releases-registry.mjs summary <bookRoot>                              注册表摘要
`);
    process.exit(0);
  }

  try {
    switch (action) {
      case 'list': {
        const releases = listReleases(bookRoot, { status: flags.status });
        if (releases.length === 0) {
          console.log('暂无发布条目');
        } else {
          console.log(`发布条目（${releases.length} 条）:`);
          releases.forEach(r => {
            console.log(`  [${r.status.padEnd(10)}] ${r.id.slice(0, 20)}...  v${r.version}  ${r.title}`);
          });
        }
        break;
      }
      case 'create': {
        const release = createRelease(bookRoot, {
          title: flags.title || '未命名',
          version: flags.version || '1.0.0',
          description: flags.description || '',
          format: flags.format || 'markdown',
          channel: flags.channel || 'default',
        });
        console.log(`已创建: ${release.id}`);
        console.log(JSON.stringify(release, null, 2));
        break;
      }
      case 'get': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const r = getRelease(bookRoot, flags.id);
        console.log(r ? JSON.stringify(r, null, 2) : '未找到');
        break;
      }
      case 'update': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const updates = {};
        if (flags.status) updates.status = flags.status;
        if (flags.title) updates.title = flags.title;
        if (flags.version) updates.version = flags.version;
        if (flags.description) updates.description = flags.description;
        const updated = updateRelease(bookRoot, flags.id, updates);
        console.log(updated ? `已更新: ${updated.id}` : '未找到');
        break;
      }
      case 'link': {
        if (!flags.id || !flags.file) { console.error('需要 --id 和 --file'); process.exit(1); }
        const linked = linkDeliverable(bookRoot, flags.id, flags.file);
        console.log(linked ? `已关联: ${flags.file}` : '未找到');
        break;
      }
      case 'delete': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const ok = deleteRelease(bookRoot, flags.id, flags.force === true);
        console.log(ok ? '已归档/删除' : '未找到');
        break;
      }
      case 'summary': {
        const summary = getRegistrySummary(bookRoot);
        console.log(JSON.stringify(summary, null, 2));
        break;
      }
      default:
        console.error(`未知动作: ${action}`);
        process.exit(1);
    }
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}
