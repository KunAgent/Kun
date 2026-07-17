/**
 * intake-runtime-hooks.mjs — 开场时对齐 ESM 体裁、并触发场景包/乐包必经路径
 *
 * 设计目标（对齐 audit-skill-runtime-2026-04-13）：
 * - 若 .fbs/esm-state.md 中 genre 为空但 project-config.json 已填 genreLevel，则补写 ESM
 * - 每次成功开场执行 loadScenePack（至少 general），保证 registerBook 乐包埋点必经
 */
import fs from 'fs';
import path from 'path';
import { recordESMTransition } from './fbs-record-esm-transition.mjs';

const GENRE_LEVEL = new Set(['A', 'B', 'C']);

/** 场景包全量加载超时（ms）；超时则降级为仅乐包 registerBook，避免首响长时间无返回 */
export const SCENE_PACK_TIMEOUT_MS = Number(process.env.FBS_SCENE_PACK_TIMEOUT_MS) || 15000;

/** @param {string} fbsDir */
export function parseEsmStateFrontmatter(fbsDir) {
  const esmPath = path.join(fbsDir, 'esm-state.md');
  if (!fs.existsSync(esmPath)) {
    return { exists: false, currentState: 'IDLE', genre: '', path: esmPath };
  }
  const text = fs.readFileSync(esmPath, 'utf8');
  const mState = text.match(/^currentState:\s*"([^"]*)"/m);
  const mGenre = text.match(/^genre:\s*"([^"]*)"/m);
  return {
    exists: true,
    currentState: (mState && mState[1].trim()) || 'IDLE',
    genre: (mGenre && mGenre[1].trim()) || '',
    path: esmPath,
  };
}

/**
 * 从 genreTag / 书名等弱信号推断场景包 id（与 scene-pack-activation-guide 关键词对齐）
 * @param {string} haystack
 * @returns {string}
 */
export function inferScenePackIdFromText(haystack) {
  const s = String(haystack || '').toLowerCase();
  if (/家谱|家史|族谱|世系|家族史/.test(s)) return 'genealogy';
  if (/白皮书|行业报告|研究报告/.test(s)) return 'whitepaper';
  if (/顾问|咨询报告/.test(s)) return 'consultant';
  if (/代写|代撰|影子/.test(s)) return 'ghostwriter';
  if (/培训|讲义|课程|教材/.test(s)) return 'training';
  if (/自传|回忆录|个人故事/.test(s)) return 'personal-book';
  if (/调查报告|深度报道|特稿|长文调查/.test(s)) return 'report';
  return 'general';
}

function readProjectConfig(bookRoot) {
  const p = path.join(bookRoot, '.fbs', 'project-config.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readBookTitleHint(bookRoot) {
  const brief = path.join(bookRoot, '.fbs', 'book-context-brief.md');
  if (fs.existsSync(brief)) {
    try {
      const t = fs.readFileSync(brief, 'utf8');
      const m = t.match(/书名[：:]\s*([^\n]+)/);
      if (m) return m[1].trim();
    } catch {
      /* ignore */
    }
  }
  return path.basename(bookRoot);
}

/**
 * @param {string} bookRoot
 * @param {string} fbsDir
 * @param {{ quiet?: boolean, fast?: boolean }} [opts]
 *   fast=true：跳过场景包网络/表格加载，仅执行乐包 registerBook（首响防卡顿）
 */
export async function maybeSyncEsmGenreAndScenePack(bookRoot, fbsDir, opts = {}) {
  const { quiet = true, fast = false } = opts;
  const result = {
    esmGenreSynced: false,
    scenePackId: 'general',
    scenePackLoaded: false,
    registerBookAttempted: false,
    scenePackSkippedFast: false,
    scenePackTimedOut: false,
    notes: [],
    errors: [],
  };

  if (!fs.existsSync(fbsDir)) {
    result.notes.push('无 .fbs 目录，跳过 ESM/场景包钩子');
    return result;
  }

  const esm = parseEsmStateFrontmatter(fbsDir);
  const cfg = readProjectConfig(bookRoot);
  const genreLevel = String(cfg?.genreLevel || '')
    .trim()
    .toUpperCase();
  const genreTag = String(cfg?.genreTag || '').trim();
  const titleHint = readBookTitleHint(bookRoot);

  const inferredPack = inferScenePackIdFromText(`${genreTag} ${titleHint}`);
  result.scenePackId = inferredPack;

  if (esm.exists && !esm.genre && genreLevel && GENRE_LEVEL.has(genreLevel)) {
    const from = esm.currentState || 'IDLE';
    const to = from === 'IDLE' ? 'INTAKE' : from;
    try {
      await recordESMTransition({
        bookRoot,
        from,
        to,
        reason: 'intake-router 自动对齐 project-config.genreLevel（audit P1-03）',
        genre: genreLevel,
        quiet,
      });
      result.esmGenreSynced = true;
      result.notes.push(`已补写 esm-state.md 体裁等级为 ${genreLevel}（${from}→${to}）`);
    } catch (e) {
      result.errors.push(`ESM 体裁对齐失败：${e.message}`);
    }
  } else if (esm.exists && !esm.genre && (!genreLevel || !GENRE_LEVEL.has(genreLevel))) {
    result.notes.push('project-config.genreLevel 未就绪，ESM 体裁等级留待 S0/S1 填写');
  }

  const runRegisterBookOnly = async () => {
    const { registerBook } = await import('./wecom/lib/user-config.mjs');
    const title = readBookTitleHint(bookRoot);
    registerBook(bookRoot, title, null, null, inferredPack || 'general');
    result.registerBookAttempted = true;
  };

  if (fast) {
    try {
      await runRegisterBookOnly();
      result.scenePackSkippedFast = true;
      result.notes.push(
        '防卡顿：已跳过场景包全量加载，仅执行乐包 registerBook（可用完整加载于后续显式场景包操作）',
      );
    } catch (e) {
      result.errors.push(`fast 乐包埋点失败：${e.message}`);
    }
    return result;
  }

  try {
    const { loadScenePack } = await import('./wecom/scene-pack-loader.mjs');
    const loadPromise = loadScenePack(bookRoot, inferredPack, 'S0');
    const timeoutMs = SCENE_PACK_TIMEOUT_MS;
    await Promise.race([
      loadPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('__FBS_SCENE_PACK_TIMEOUT__')), timeoutMs);
      }),
    ]);
    result.scenePackLoaded = true;
    result.registerBookAttempted = true;
    result.notes.push(`已加载场景包（${inferredPack}，S0）并尝试乐包 registerBook 埋点`);
  } catch (e) {
    if (e.message === '__FBS_SCENE_PACK_TIMEOUT__') {
      result.scenePackTimedOut = true;
      try {
        await runRegisterBookOnly();
        result.notes.push(
          `场景包加载超过 ${SCENE_PACK_TIMEOUT_MS}ms，已降级为仅乐包 registerBook（避免首响卡顿）`,
        );
      } catch (e2) {
        result.errors.push(`超时降级 registerBook 失败：${e2.message}`);
      }
    } else {
      result.errors.push(`场景包/乐包钩子失败：${e.message}`);
    }
  }

  return result;
}
