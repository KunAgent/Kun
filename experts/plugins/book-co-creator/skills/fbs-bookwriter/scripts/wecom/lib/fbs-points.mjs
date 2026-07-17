#!/usr/bin/env node
/**
 * scripts/wecom/lib/fbs-points.mjs
 * .fbs/points.json 用户积分文件操作工具（FIX-P2-03）
 *
 * 背景：_plugin_meta.json 声明了 user_data.points_file: ".fbs/points.json"，
 * 但之前无任何代码对该路径进行读写，属于"孤儿路径"声明。
 * 本文件为该路径提供完整的 CRUD 操作实现。
 *
 * 与 credits-ledger.mjs 的关系：
 *   - credits-ledger.mjs：乐包积分体系（场景包权益门槛，全局账本）
 *   - fbs-points.mjs（本文件）：用户个人积分文件（书级/会话级行为统计，可扩展）
 *   两者相互独立，不共享数据。
 *
 * 文件位置：{bookRoot}/.fbs/points.json（书级，随书稿目录）
 *
 * 对外 API：
 *   readPoints(bookRoot)                → object  读取积分记录
 *   writePoints(bookRoot, data)         → void    写入积分记录（原子写入）
 *   addPoint(bookRoot, event, amount)   → number  增加积分
 *   getPointsSummary(bookRoot)          → string  Markdown 格式摘要
 */

import fs   from 'fs';
import path from 'path';

const POINTS_FILE = '.fbs/points.json';

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function _pointsPath(bookRoot) {
  return path.join(path.resolve(bookRoot), POINTS_FILE);
}

function _emptyPoints(bookRoot) {
  return {
    _version:    '1.0',
    _comment:    '书级用户积分记录（自动生成，与乐包账本 credits-ledger.json 相互独立）',
    bookRoot:    path.resolve(bookRoot),
    totalPoints: 0,
    events:      [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 读取 .fbs/points.json（不存在时返回空结构）
 * @param {string} bookRoot
 * @returns {object}
 */
export function readPoints(bookRoot) {
  const filePath = _pointsPath(bookRoot);
  if (!fs.existsSync(filePath)) return _emptyPoints(bookRoot);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...(_emptyPoints(bookRoot)), ...raw };
  } catch {
    return _emptyPoints(bookRoot);
  }
}

/**
 * 写入 .fbs/points.json（原子写入）
 * @param {string} bookRoot
 * @param {object} data
 */
export function writePoints(bookRoot, data) {
  const filePath = _pointsPath(bookRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * 为某本书增加积分（书级行为统计）
 * @param {string} bookRoot
 * @param {string} event  - 事件名称（如 'chapter_written'、'quality_passed'）
 * @param {number} amount - 积分增量（默认 1）
 * @param {string} [note] - 备注
 * @returns {number} 新的 totalPoints
 */
export function addPoint(bookRoot, event, amount = 1, note = '') {
  const data = readPoints(bookRoot);
  data.totalPoints = (data.totalPoints ?? 0) + amount;
  data.events.push({
    event,
    amount,
    note,
    ts: new Date().toISOString(),
  });
  writePoints(bookRoot, data);
  return data.totalPoints;
}

/**
 * 获取积分摘要（Markdown）
 * @param {string} bookRoot
 * @returns {string}
 */
export function getPointsSummary(bookRoot) {
  const data = readPoints(bookRoot);
  const lines = [
    `**书级积分：${data.totalPoints} 分**`,
    '',
    `_书稿路径：${data.bookRoot}_`,
    `_累计事件：${data.events.length} 次_`,
  ];
  if (data.events.length > 0) {
    lines.push('');
    lines.push('**最近 5 条记录：**');
    const recent = [...data.events].slice(-5).reverse();
    for (const e of recent) {
      lines.push(`- [${e.ts.slice(0, 10)}] ${e.event}: +${e.amount}${e.note ? ` （${e.note}）` : ''}`);
    }
  }
  return lines.join('\n');
}
