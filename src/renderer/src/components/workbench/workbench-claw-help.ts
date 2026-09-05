export function buildWorkbenchClawHelpText(
  t: (key: string) => string
): string {
  return [
    t('clawHelpTitle'),
    '',
    `- \`/help\`: ${t('clawHelpCommandHelp')}`,
    `- \`/new\`: ${t('clawHelpCommandNew')}`,
    `- \`/clear\`: ${t('clawHelpCommandClear')}`,
    `- \`/list-model\`: ${t('clawHelpCommandModelList')}`,
    `- \`/model <number>\`: ${t('clawHelpCommandModelSwitch')}`
  ].join('\n')
}
