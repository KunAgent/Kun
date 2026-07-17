#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { runChannelPack } from './lib/channel-pack.mjs';

export function runWorkBuddyPack() {
  return runChannelPack({
    version: '2.1.2',
    packageName: 'fbs-bookwriter-v212-workbuddy',
    packageRootName: 'fbs-bookwriter',
    channelLabel: 'WorkBuddy Marketplace',
    requiredDirs: [
      'workbuddy/',
      'codebuddy/',
      '.codebuddy/agents/',
      '.codebuddy/providers/',
      '.codebuddy-plugin/',
    ],
    coreFiles: [
      'workbuddy/channel-manifest.json',
      'codebuddy/channel-manifest.json',
      'codebuddy/agents/fbs-team-lead.md',
      '.codebuddy/agents/fbs-team-lead.md',
      '.codebuddy/providers/provider-registry.yml',
      '.codebuddy-plugin/plugin.json',
      'releases/workbuddy-review-v2.1.2.md',
    ],
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkBuddyPack();
}
