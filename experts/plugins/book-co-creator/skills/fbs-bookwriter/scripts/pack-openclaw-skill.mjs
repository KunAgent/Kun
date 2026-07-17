#!/usr/bin/env node
/**
 * OpenClaw 技能包：与 WorkBuddy/CodeBuddy 市场通道解耦，使用 openclaw/fbs_bookwriter/SKILL.md 作为入口。
 * 产物：dist/fbs-bookwriter-v212-openclaw.zip（根目录名 fbs_bookwriter，符合 OpenClaw snake_case 习惯）
 */
import { fileURLToPath } from 'url';
import { runChannelPack } from './lib/channel-pack.mjs';

export function runOpenClawPack() {
  return runChannelPack({
    version: '2.1.2',
    packageName: 'fbs-bookwriter-v212-openclaw',
    packageRootName: 'fbs_bookwriter',
    channelLabel: 'OpenClaw',
    skillMdOverride: 'openclaw/fbs_bookwriter/SKILL.md',
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  runOpenClawPack();
}
