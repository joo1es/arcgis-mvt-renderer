/**
 * fixWinding.ts 验收测试
 * 运行: node --experimental-strip-types verify.ts
 */
import { readFileSync } from 'node:fs'
import { fixTileWinding } from '../../src/core/mvt/fixWinding.ts'
import { decodeTile, signedArea } from './decode.mjs'

const buf = readFileSync(new URL('./sample-z2.pbf', import.meta.url))

function stats(bytes: Uint8Array) {
  const layers = decodeTile(Buffer.from(bytes))
  const rings = layers
    .flatMap((l: any) => l.features.filter((f: any) => f.type === 'polygon'))
    .flatMap((f: any) => f.geometry)
    .filter((r: any[]) => r.length >= 3)
  let cw = 0
  let ccw = 0
  for (const r of rings) (signedArea(r) > 0 ? cw++ : ccw++)
  return { layers, rings: rings.length, cw, ccw }
}

const original = new Uint8Array(buf)
const base = stats(original)

console.log('1) 合规瓦片 —— 应原样返回')
const r1 = fixTileWinding(original)
console.log(`   action=${r1.action}  环数=${r1.rings}  表决 CW:${r1.sample.cw} CCW:${r1.sample.ccw} 置信度=${(r1.sample.confidence * 100).toFixed(0)}%`)
console.log(`   字节未变: ${Buffer.compare(Buffer.from(r1.data), Buffer.from(original)) === 0}`)

console.log('\n2) 构造违规瓦片 —— 手动翻转全部环')
const flipped = Buffer.from(r1.data)
// 用 splice 里已验证的变换逻辑构造
const { transformTile } = await import('./splice.mjs')
const bad = transformTile(flipped, (rings: number[][][]) => rings.map((r) => [...r].reverse()))
const badStats = stats(bad)
console.log(`   环数=${badStats.rings}  CW:${badStats.cw} CCW:${badStats.ccw}`)

console.log('\n3) 修正违规瓦片')
const r2 = fixTileWinding(bad)
const fixedStats = stats(r2.data)
console.log(`   action=${r2.action}  表决 CW:${r2.sample.cw} CCW:${r2.sample.ccw} 置信度=${(r2.sample.confidence * 100).toFixed(0)}%`)
console.log(`   修正后 CW:${fixedStats.cw} CCW:${fixedStats.ccw}`)
console.log(`   与原始瓦片绕向分布一致: ${fixedStats.cw === base.cw && fixedStats.ccw === base.ccw}`)

console.log('\n4) 属性完整性')
const a = JSON.stringify(base.layers.map((l: any) => l.features.map((f: any) => f.properties)))
const b = JSON.stringify(fixedStats.layers.map((l: any) => l.features.map((f: any) => f.properties)))
console.log(`   所有要素属性完全一致: ${a === b}`)
console.log(`   要素数: ${base.layers.reduce((s: number, l: any) => s + l.features.length, 0)} -> ${fixedStats.layers.reduce((s: number, l: any) => s + l.features.length, 0)}`)
