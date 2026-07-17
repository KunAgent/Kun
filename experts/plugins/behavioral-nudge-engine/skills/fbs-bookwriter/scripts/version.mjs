#!/usr/bin/env node
/**
 * FBS-BookWriter 版本号定义
 */

export const VERSION = '2.1.2';

export const VERSION_INFO = {
  major: 2,
  minor: 1,
  patch: 2,
  full: '2.1.2',
  date: '2026-04-16',
  name: '长上下文钉住·阶段门禁执行锁·质检强制闭环版',
};

/**
 * 获取版本号
 * @returns {string} - 版本号
 */
export function getVersion() {
  return VERSION;
}

/**
 * 获取版本信息
 * @returns {object} - 版本信息对象
 */
export function getVersionInfo() {
  return { ...VERSION_INFO };
}

/**
 * 比较版本号
 * @param {string} versionA - 版本号A
 * @param {string} versionB - 版本号B
 * @returns {number} - 负数(A<B), 0(A==B), 正数(A>B)
 */
export function compareVersions(versionA, versionB) {
  const parseVer = (v) => {
    const clean = String(v).replace(/[^0-9.]/g, '');
    return clean.split('.').map(Number);
  };
  const [majorA, minorA = 0, patchA = 0] = parseVer(versionA);
  const [majorB, minorB = 0, patchB = 0] = parseVer(versionB);
  if (majorA !== majorB) return majorA - majorB;
  if (minorA !== minorB) return minorA - minorB;
  return patchA - patchB;
}

/**
 * 格式化版本号
 * @param {string} format - 格式 (default: full)
 * @returns {string} - 格式化后的版本号
 */
export function formatVersion(format = 'full') {
  switch (format) {
    case 'short':
      return VERSION;
    case 'major':
      return VERSION_INFO.major.toString();
    case 'major.minor':
      return `${VERSION_INFO.major}.${VERSION_INFO.minor}`;
    case 'full':
    default:
      return `FBS-BookWriter v${VERSION}`;
  }
}

/**
 * 版本号字符串
 */
export const VERSION_STRING = formatVersion('full');
