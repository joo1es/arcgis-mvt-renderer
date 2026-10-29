/**
 * 批量检查公开瓦片金字塔，并生成「违规镜像」用于 A/B 对比
 * 运行: node --experimental-strip-types batch.ts
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fixTileWinding } from '../../src/core/mvt/fixWinding.ts'
import { transformTile } from '../mvt-parser/splice.mjs'

const ROOT = new URL('./tiles/good', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BAD = new URL('./tiles/bad', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.pbf')) out.push(full)
  }
  return out
}

const files = walk(ROOT).sort()
console.log(`扫描 ${files.length} 张瓦片\n`)

let reversed = 0
let unchanged = 0
let totalRings = 0
const rows: string[] = []

for (const file of files) {
  const buf = new Uint8Array(readFileSync(file))
  const r = fixTileWinding(buf)
  totalRings += r.rings
  if (r.action === 'reversed') reversed++
  else unchanged++

  const rel = relative(ROOT, file).replace(/\\/g, '/')
  rows.push(
    `${rel.padEnd(14)} ${String(r.rings).padStart(4)} 环  ` +
      `CW:${String(r.sample.cw).padStart(2)} CCW:${String(r.sample.ccw).padStart(2)}  ` +
      `${(r.sample.confidence * 100).toFixed(0).padStart(3)}%  ${r.action}`
  )
}

console.log(rows.join('\n'))
console.log(`\n合计 ${totalRings} 个环`)
console.log(`合规(unchanged): ${unchanged}   需修正(reversed): ${reversed}`)
console.log(
  reversed === 0
    ? '→ 公开数据集完全符合 MVT 规范，检测器零误报'
    : '→ 检测到不合规瓦片'
)

// 生成违规镜像：把每张瓦片的所有环反向
console.log('\n生成违规镜像 (tiles/bad) ...')
let made = 0
for (const file of files) {
  const buf = new Uint8Array(readFileSync(file))
  const flipped = transformTile(buf, (rings: number[][][]) => rings.map((r) => [...r].reverse()))
  const dest = join(BAD, relative(ROOT, file))
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, flipped)
  made++
}
console.log(`已生成 ${made} 张违规瓦片`)

// 抽一张验证：镜像后应被检测为需修正，修正后应回到原状
const probe = files.find((f) => f.endsWith('2\\2\\1.pbf')) ?? files[0]
const badBuf = new Uint8Array(readFileSync(join(BAD, relative(ROOT, probe))))
const check = fixTileWinding(badBuf)
console.log(`\n抽样验证 ${relative(ROOT, probe).replace(/\\/g, '/')}:`)
console.log(`  违规瓦片表决 CW:${check.sample.cw} CCW:${check.sample.ccw} → ${check.action}`)
