#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { runChannelPack } from './lib/channel-pack.mjs';

export function runCodeBuddyPack() {
  return runChannelPack({
    version: '2.1.2',
    packageName: 'fbs-bookwriter-v212-codebuddy',
    packageRootName: 'fbs-bookwriter',
    channelLabel: 'CodeBuddy Plugin',
    requiredDirs: [
      'codebuddy/',
      'workbuddy/',
      '.codebuddy/agents/',
      '.codebuddy/providers/',
      '.codebuddy-plugin/',
    ],
    coreFiles: [
      'codebuddy/channel-manifest.json',
      'workbuddy/channel-manifest.json',
      '.codebuddy/agents/fbs-team-lead.md',
      '.codebuddy/providers/provider-registry.yml',
      '.codebuddy-plugin/plugin.json',
      'releases/codebuddy-review-v2.1.2.md',
    ],
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  runCodeBuddyPack();
}
