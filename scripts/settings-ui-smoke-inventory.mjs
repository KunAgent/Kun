import assert from 'node:assert/strict'

/** Match the navigation declared by the measured checkout, including legacy baselines. */
export function settingsCategoryInventory(source, platform) {
  const items = [...source.matchAll(/\{\s*category:\s*'([^']+)'([^{}]*)\}/g)]
  assert.ok(items.length > 0, 'Measured source must declare its settings navigation')
  const categories = items.filter(([, , attributes]) =>
    platform === 'win32' || !/windowsOnly:\s*true/.test(attributes)).map(([, category]) => category)
  assert.equal(new Set(categories).size, categories.length, 'Source navigation must not contain duplicate destinations')
  return categories
}

/** Keep the current fixture's coverage count independent of parsed/rendered navigation. */
export function assertCurrentSettingsCategoryInventory(categories, platform) {
  // Connections, Storage & cleanup, and Pets are separate desktop destinations.
  assert.equal(new Set(categories).size, platform === 'win32' ? 36 : 35,
    'Current settings smoke must cover every destination')
  assert(!categories.includes('integrations'), 'Retired integrations must not appear in settings navigation')
}
