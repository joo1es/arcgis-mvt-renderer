/**
 * MVT 绕向修正 —— 「只写几何」的最小实现
 *
 * 核心思路：不重编码整个瓦片，只替换 Feature 的 geometry 字段，
 * 其余字节（name / keys / values / extent / version / id / tags）原样透传。
 * 这样完全不需要实现 Value 的 7 种类型序列化，spec 暴露面被压到最小。
 *
 * 用法:
 *   node splice.mjs <tile.pbf>            检测绕向并输出修正结果
 *   node splice.mjs <tile.pbf> --roundtrip 语义往返测试
 *   node splice.mjs <tile.pbf> --flip      强制翻转全部环后自检
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  CMD,
  decodeTile,
  detectTileOrientation,
  fields,
  packedVarints,
  readVarint,
  signedArea,
  zigzag,
} from './decode.mjs'

// ---------- 编码器（只需要写 varint 和几何指令） ----------

function writeVarint(value) {
  const bytes = []
  let v = value
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  bytes.push(v)
  return bytes
}

function zigzagEncode(n) {
  return n >= 0 ? n * 2 : -n * 2 - 1
}

/**
 * 将环数组编码回 MVT 几何指令流。
 * 注意：坐标游标在整个 Feature 内连续累积，跨环不重置。
 */
export function encodeGeometry(rings) {
  const cmds = []
  let cx = 0
  let cy = 0

  for (const ring of rings) {
    if (!ring.length) continue

    const [x0, y0] = ring[0]
    cmds.push((1 << 3) | CMD.MOVE_TO)
    cmds.push(zigzagEncode(x0 - cx), zigzagEncode(y0 - cy))
    cx = x0
    cy = y0

    if (ring.length > 1) {
      cmds.push(((ring.length - 1) << 3) | CMD.LINE_TO)
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i]
        cmds.push(zigzagEncode(x - cx), zigzagEncode(y - cy))
        cx = x
        cy = y
      }
    }

    cmds.push((1 << 3) | CMD.CLOSE_PATH)
  }

  return Buffer.from(cmds.flatMap(writeVarint))
}

// ---------- 长度感知的消息重建 ----------

/** 通用：遍历字段，允许对指定字段替换 payload，并自动重算长度前缀 */
function rebuildMessage(buf, replace) {
  let pos = 0
  const out = []
  while (pos < buf.length) {
    const start = pos
    let key
    ;[key, pos] = readVarint(buf, pos)
    const field = key >>> 3
    const wire = key & 0x7

    out.push(Buffer.from(writeVarint(key)))

    if (wire === 0) {
      let v
      ;[v, pos] = readVarint(buf, pos)
      out.push(Buffer.from(writeVarint(v)))
    } else if (wire === 1) {
      out.push(buf.subarray(pos, pos + 8))
      pos += 8
    } else if (wire === 5) {
      out.push(buf.subarray(pos, pos + 4))
      pos += 4
    } else if (wire === 2) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      let payload = buf.subarray(pos, pos + len)
      pos += len

      const replaced = replace?.(field, payload)
      if (replaced !== undefined) payload = replaced

      out.push(Buffer.from(writeVarint(payload.length)), payload)
    } else {
      throw new Error(`不支持 wire type ${wire} (offset ${start})`)
    }
  }
  return Buffer.concat(out)
}

// ---------- 几何层面的变换 ----------

/** 翻转一个 Feature 的所有环 */
function reverseAllRings(rings) {
  return rings.map((r) => [...r].reverse())
}

/** 处理单个 Feature 消息，可选地替换其 geometry 字段 */
function rebuildFeature(featureBuf, transform) {
  let changed = false

  const rebuilt = rebuildMessage(featureBuf, (field, payload) => {
    if (field !== 4) return undefined // 只关心 geometry
    const rings = decodeGeometryFromField(payload)
    const next = transform(rings)
    if (!next) return undefined
    changed = true
    return encodeGeometry(next)
  })

  return changed ? rebuilt : featureBuf
}

function decodeGeometryFromField(payload) {
  const cmds = packedVarints(payload)
  const rings = []
  let x = 0
  let y = 0
  let current = null
  let i = 0

  while (i < cmds.length) {
    const cmdInt = cmds[i++]
    const id = cmdInt & 0x7
    const count = cmdInt >>> 3
    if (id === CMD.MOVE_TO) {
      for (let k = 0; k < count; k++) {
        x += zigzag(cmds[i++])
        y += zigzag(cmds[i++])
        current = [[x, y]]
        rings.push(current)
      }
    } else if (id === CMD.LINE_TO) {
      for (let k = 0; k < count; k++) {
        x += zigzag(cmds[i++])
        y += zigzag(cmds[i++])
        current.push([x, y])
      }
    } else if (id === CMD.CLOSE_PATH) {
      // 隐式闭合
    } else {
      throw new Error(`非法几何指令 ${id}`)
    }
  }
  return rings
}

/**
 * 对整个瓦片应用几何变换。
 * 只有 polygon 图层会被处理；point / linestring 原样保留。
 */
export function transformTile(buf, transform, options = {}) {
  const { polygonLayersOnly = true } = options

  return rebuildMessage(buf, (field, layerPayload) => {
    if (field !== 3) return undefined // 只处理 Tile.layers

    return rebuildMessage(layerPayload, (lField, featurePayload) => {
      if (lField !== 2) return undefined // 只处理 Layer.features

      // 判断该 Feature 是否为 polygon：读取 type 字段（field 3, varint）
      const geomType = readFeatureType(featurePayload)
      if (polygonLayersOnly && geomType !== 3) return undefined

      return rebuildFeature(featurePayload, transform)
    })
  })
}

function readFeatureType(featureBuf) {
  for (const { field, value } of fields(featureBuf)) {
    if (field === 3) return Number(value)
  }
  return 0
}

/** 检测整个瓦片是否需要翻转，需要则翻转全部环 */
export function fixTileWinding(buf) {
  const layers = decodeTile(buf)
  const rings = layers
    .flatMap((l) => l.features.filter((f) => f.type === 'polygon'))
    .flatMap((f) => f.geometry)
    .filter((r) => r.length >= 3)

  if (!rings.length) return { buffer: buf, action: 'skipped', orientation: 'unknown', rings: 0 }

  const orient = detectTileOrientation(rings)
  if (orient.orientation === 'cw') {
    return { buffer: buf, action: 'unchanged', orientation: 'cw', rings: rings.length, orient }
  }

  const out = transformTile(buf, reverseAllRings)
  return { buffer: out, action: 'reversed', orientation: 'ccw', rings: rings.length, orient }
}

// ---------- 语义比较 ----------

function canonical(layers) {
  return JSON.stringify(
    layers.map((l) => ({
      name: l.name,
      extent: l.extent,
      version: l.version,
      features: l.features.map((f) => ({
        id: f.id,
        type: f.type,
        props: Object.keys(f.properties)
          .sort()
          .map((k) => [k, f.properties[k]]),
        geometry: f.geometry,
      })),
    }))
  )
}

function summarize(buf, label) {
  const layers = decodeTile(buf)
  const polys = layers.flatMap((l) => l.features.filter((f) => f.type === 'polygon'))
  const rings = polys.flatMap((f) => f.geometry).filter((r) => r.length >= 3)
  let cw = 0
  let ccw = 0
  for (const r of rings) (signedArea(r) > 0 ? cw++ : ccw++)
  console.log(`  ${label}: ${buf.length} bytes, ${rings.length} 环 (CW ${cw} / CCW ${ccw})`)
  return { layers, cw, ccw }
}

// ---------- CLI ----------

if (process.argv[1] && process.argv[1].endsWith('splice.mjs')) {
  const file = process.argv[2] || 'sample-z2.pbf'
  const original = readFileSync(file)

  console.log(`源瓦片: ${file}\n`)

  if (process.argv.includes('--roundtrip')) {
    console.log('测试 A — 语义往返（解码 → 重编码 → 再解码）')
    const a = summarize(original, '原始  ')
    const reencoded = transformTile(original, (rings) => rings) // 恒等变换，强制重编码
    const b = summarize(reencoded, '重编码')
    const same = canonical(a.layers) === canonical(b.layers)
    console.log(`  几何与属性完全一致: ${same ? '是' : '否'}`)
    console.log(`  字节完全一致: ${original.equals(reencoded) ? '是' : '否（命令流被规范化）'}\n`)

    console.log('测试 B — 强制翻转全部环')
    const flipped = transformTile(original, reverseAllRings)
    const c = summarize(flipped, '翻转后')
    const swapped = c.cw === a.ccw && c.ccw === a.cw
    console.log(`  绕向已整体反转: ${swapped ? '是' : '否'}（CW/CCW 计数互换）`)
    console.log(`  体积变化: ${flipped.length - original.length >= 0 ? '+' : ''}${flipped.length - original.length} bytes\n`)

    console.log('测试 C — 对翻转后的瓦片执行修正')
    const fixed = fixTileWinding(flipped)
    const d = summarize(fixed.buffer, '修正后')
    console.log(`  动作: ${fixed.action}`)
    console.log(`  与原瓦片语义一致: ${canonical(a.layers) === canonical(d.layers) ? '是' : '否'}\n`)

    console.log('测试 D — 对合规瓦片执行修正（应原样返回）')
    const noop = fixTileWinding(original)
    console.log(`  动作: ${noop.action}  字节未变: ${original.equals(noop.buffer) ? '是' : '否'}`)
  } else if (process.argv.includes('--flip')) {
    const flipped = transformTile(original, reverseAllRings)
    const out = file.replace(/\.pbf$/, '.flipped.pbf')
    writeFileSync(out, flipped)
    summarize(original, '原始  ')
    summarize(flipped, '翻转后')
    console.log(`\n已写出: ${out}`)
  } else {
    const result = fixTileWinding(original)
    summarize(original, '输入  ')
    console.log(`\n整瓦片绕向: ${result.orientation.toUpperCase()}  置信度 ${(result.orient?.confidence * 100 || 0).toFixed(0)}%`)
    console.log(`处理动作: ${result.action}`)
    if (result.action === 'reversed') {
      const out = file.replace(/\.pbf$/, '.fixed.pbf')
      writeFileSync(out, result.buffer)
      summarize(result.buffer, '输出  ')
      console.log(`已写出: ${out}`)
    }
  }
}
