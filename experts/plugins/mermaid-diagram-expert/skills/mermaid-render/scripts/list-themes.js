#!/usr/bin/env node
/**
 * 列出所有可用的内置主题
 * 
 * 用法: node list-themes.js
 */

let THEMES
try {
  const lib = require('beautiful-mermaid')
  THEMES = lib.THEMES
} catch (e) {
  console.error('❌ 渲染引擎未安装。请先执行: bash scripts/setup.sh')
  process.exit(1)
}

console.log('📎 可用内置主题列表\n')
console.log('━'.repeat(60))
console.log(`${'主题名称'.padEnd(24)} ${'类型'.padEnd(6)} ${'背景'.padEnd(10)} ${'强调色'}`)
console.log('━'.repeat(60))

for (const [name, colors] of Object.entries(THEMES)) {
  const type = isLight(colors.bg) ? '浅色' : '深色'
  const accent = colors.accent || '自动推导'
  console.log(`${name.padEnd(24)} ${type.padEnd(6)} ${colors.bg.padEnd(10)} ${accent}`)
}

console.log('━'.repeat(60))
console.log(`\n共 ${Object.keys(THEMES).length} 个主题`)
console.log('\n💡 使用方式:')
console.log('   node render-svg.js input.mmd output.svg <主题名>')
console.log('\n💡 自定义配色:')
console.log('   node render-svg.js input.mmd output.svg custom \'{"bg":"#1a1a2e","fg":"#eaeaea"}\'')

function isLight(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
