/**
 * 发布前产物校验
 * 运行: node scripts/verify-dist.mjs
 */
import { existsSync, statSync, readFileSync } from 'node:fs'

const REQUIRED = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/engines/maplibre.js',
  'dist/engines/maplibre.cjs',
  'dist/mvt-sw.js',
]

let failed = false

const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failed = true
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

console.log('检查必需产物:')
for (const file of REQUIRED) {
  if (!existsSync(file)) {
    fail(`缺少 ${file}`)
    continue
  }
  ok(`${file}  ${(statSync(file).size / 1024).toFixed(2)} KiB`)
}

console.log('\n检查主入口是否已与 maplibre 解耦:')
for (const file of ['dist/index.js', 'dist/index.cjs']) {
  if (!existsSync(file)) continue
  const code = readFileSync(file, 'utf8')

  const esmStatic = /^\s*import\s[^\n]*from\s*["']maplibre-gl["']/m.test(code)
  const cjsRequire = /\brequire\(\s*["']maplibre-gl["']\s*\)/.test(code)
  const dynamicLiteral = /\bimport\(\s*["']maplibre-gl["']\s*\)/.test(code)

  if (esmStatic || cjsRequire) fail(`${file} 仍静态依赖 maplibre-gl`)
  else if (dynamicLiteral) fail(`${file} 含字面量 import('maplibre-gl')，消费者打包器仍会强制解析该依赖`)
  else ok(`${file} 无 maplibre-gl 静态/字面量依赖`)

  if (/\.maplibregl-/.test(code)) fail(`${file} 内联了 maplibre 样式`)
  else ok(`${file} 无内联 maplibre 样式`)
}

console.log('\n检查 maplibre 子入口:')
if (existsSync('dist/engines/maplibre.js')) {
  const sub = readFileSync('dist/engines/maplibre.js', 'utf8')
  if (/from\s*["']maplibre-gl["']/.test(sub)) ok('子入口按预期引用 maplibre-gl')
  else fail('子入口未引用 maplibre-gl，注册逻辑可能失效')
}

console.log('\n检查 Service Worker 自包含性:')
if (existsSync('dist/mvt-sw.js')) {
  const sw = readFileSync('dist/mvt-sw.js', 'utf8')

  if (/^\s*import\s/m.test(sw)) fail('mvt-sw.js 含顶层 import，无法作为独立 SW 运行')
  else ok('无顶层 import')

  if (/\brequire\s*\(/.test(sw)) fail('mvt-sw.js 含 require()，无法在浏览器运行')
  else ok('无 CommonJS require')

  if (!sw.includes('fixTileWinding')) fail('mvt-sw.js 未包含绕向修正逻辑')
  else ok('包含绕向修正逻辑')

  const size = statSync('dist/mvt-sw.js').size
  if (size > 100 * 1024) fail(`mvt-sw.js 体积异常: ${(size / 1024).toFixed(1)} KiB`)
  else ok(`体积 ${(size / 1024).toFixed(2)} KiB`)
}

console.log('\n检查包体积:')
for (const file of ['dist/index.js', 'dist/index.cjs']) {
  if (!existsSync(file)) continue
  const kb = statSync(file).size / 1024
  if (kb > 200) fail(`${file} 体积 ${kb.toFixed(1)} KiB，疑似把外部依赖打进了产物`)
  else ok(`${file} ${kb.toFixed(1)} KiB`)
}

if (failed) {
  console.error('\n产物校验未通过')
  process.exit(1)
}
console.log('\n产物校验通过')
