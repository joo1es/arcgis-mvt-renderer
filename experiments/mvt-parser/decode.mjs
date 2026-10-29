/**
 * 零依赖 MVT (Mapbox Vector Tile) 解析器 —— 概念验证
 *
 * 目的：证明「解析 MVT」与「MapLibre」完全无关。
 * 只用原生 JS 完成 protobuf 解码 + 几何指令还原 + 环绕向判定与修正，
 * 不引入 pbf、@mapbox/vector-tile、earcut、maplibre-gl 中的任何一个。
 *
 * 用法: node decode.mjs <tile.pbf> [--selftest]
 */

export const CMD = { MOVE_TO: 1, LINE_TO: 2, CLOSE_PATH: 7 }
const GEOM_TYPE = { 0: 'unknown', 1: 'point', 2: 'linestring', 3: 'polygon' }

// ---------- protobuf 基础读取 ----------

export function readVarint(buf, pos) {
  let result = 0
  let shift = 0
  let byte
  do {
    byte = buf[pos++]
    result += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80)
  return [result, pos]
}

export function zigzag(n) {
  return (n >>> 1) ^ -(n & 1)
}

/** 遍历一段 buffer 内的所有 protobuf 字段 */
export function* fields(buf, start = 0, end = buf.length) {
  let pos = start
  while (pos < end) {
    let key
    ;[key, pos] = readVarint(buf, pos)
    const field = key >>> 3
    const wire = key & 0x7

    if (wire === 0) {
      let value
      ;[value, pos] = readVarint(buf, pos)
      yield { field, value }
    } else if (wire === 1) {
      yield { field, value: buf.subarray(pos, pos + 8) }
      pos += 8
    } else if (wire === 2) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      yield { field, value: buf.subarray(pos, pos + len) }
      pos += len
    } else if (wire === 5) {
      yield { field, value: buf.subarray(pos, pos + 4) }
      pos += 4
    } else {
      throw new Error(`不支持的 protobuf wire type: ${wire}`)
    }
  }
}

export function packedVarints(buf) {
  const out = []
  let pos = 0
  while (pos < buf.length) {
    let v
    ;[v, pos] = readVarint(buf, pos)
    out.push(v)
  }
  return out
}

// ---------- MVT 结构解码 ----------

function decodeValue(buf) {
  for (const { field, value } of fields(buf)) {
    switch (field) {
      case 1: return new TextDecoder().decode(value)
      case 2: return new Float32Array(value.slice().buffer)[0]
      case 3: return new Float64Array(value.slice().buffer)[0]
      case 4: case 5: return Number(value)
      case 6: return zigzag(Number(value))
      case 7: return value !== 0
    }
  }
  return null
}

/**
 * 将 MVT 几何指令流还原为环数组（tile 像素坐标，y 轴向下，extent 通常 4096）
 * CommandInteger = (count << 3) | id；参数为 zigzag 编码的增量坐标
 */
export function decodeGeometry(cmds) {
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
      // 顶点已完整，闭合是隐式的
    } else {
      throw new Error(`非法几何指令: ${id}`)
    }
  }
  return rings
}

function decodeFeature(buf, keys, values) {
  const feature = { id: null, type: 'unknown', tags: [], geometry: [], properties: {} }

  for (const { field, value } of fields(buf)) {
    if (field === 1) feature.id = Number(value)
    else if (field === 2) feature.tags = packedVarints(value)
    else if (field === 3) feature.type = GEOM_TYPE[value] ?? 'unknown'
    else if (field === 4) feature.geometry = decodeGeometry(packedVarints(value))
  }

  for (let i = 0; i < feature.tags.length; i += 2) {
    const k = keys[feature.tags[i]]
    const v = values[feature.tags[i + 1]]
    if (k !== undefined) feature.properties[k] = v
  }
  return feature
}

function decodeLayer(buf) {
  const layer = { name: '', version: 1, extent: 4096, keys: [], values: [], features: [] }

  for (const { field, value } of fields(buf)) {
    if (field === 1) layer.name = new TextDecoder().decode(value)
    else if (field === 2) layer.features.push(value) // 延后解码，需先拿到 keys/values
    else if (field === 3) layer.keys.push(new TextDecoder().decode(value))
    else if (field === 4) layer.values.push(decodeValue(value))
    else if (field === 5) layer.extent = Number(value)
    else if (field === 15) layer.version = Number(value)
  }

  layer.features = layer.features.map((raw) => decodeFeature(raw, layer.keys, layer.values))
  return layer
}

export function decodeTile(buf) {
  const layers = []
  for (const { field, value } of fields(buf)) {
    if (field === 3) layers.push(decodeLayer(value))
  }
  return layers
}

// ---------- 绕向判定与修正 ----------

/**
 * 鞋带公式求有符号面积。
 * MVT 坐标系 y 轴向下，因此「正面积」= 视觉顺时针 (CW)。
 * 规范：外环必须 CW（正），孔洞必须 CCW（负）。
 */
export function signedArea(ring) {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

/** 射线法：点是否在多边形内 */
function pointInRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * 核心：判断一个 feature 内每个环的「应有角色」。
 *
 * 不能靠下标（一个 feature 可能是 MultiPolygon），也不能靠面积符号
 * （那正是我们要检验的东西）。唯一独立、可靠的判据是**嵌套层数**：
 * 被偶数个环包含 → 外环；被奇数个环包含 → 孔洞。
 */
export function classifyRings(rings) {
  const items = rings
    .filter((r) => r.length >= 3)
    .map((ring) => ({ ring, area: signedArea(ring), absArea: Math.abs(signedArea(ring)) }))

  // 面积大的先处理，保证包含关系自外向内判定
  const order = [...items].sort((a, b) => b.absArea - a.absArea)

  for (const item of order) {
    const probe = item.ring[0]
    let depth = 0
    for (const other of items) {
      if (other === item) continue
      if (other.absArea <= item.absArea) continue
      if (pointInRing(probe, other.ring)) depth++
    }
    item.depth = depth
    item.shouldBeExterior = depth % 2 === 0
    item.actualIsExterior = item.area > 0
    item.conforms = item.shouldBeExterior === item.actualIsExterior
  }

  return items
}

/** 按应有角色修正绕向，返回新的环数组与修正计数 */
export function fixRings(rings) {
  const items = classifyRings(rings)
  let reversed = 0
  const out = items.map((item) => {
    if (item.conforms) return item.ring
    reversed++
    return [...item.ring].reverse()
  })
  return { rings: out, reversed }
}

/**
 * 整瓦片绕向约定探测（更稳健的方案）。
 *
 * 现实中的切片管道不会在同一个瓦片里混用两种约定：要么整体合规，
 * 要么整体反过来（例如 PostGIS 未调用 ST_ForcePolygonCW）。
 * 因此只需取面积最大的若干个环做多数表决，得到一个「一比特」结论，
 * 然后统一翻转——这样能完全绕开逐环包含判定在共享边界上的误判。
 */
export function detectTileOrientation(allRings, sampleSize = 20) {
  const sorted = [...allRings]
    .filter((r) => r.length >= 3)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
    .slice(0, sampleSize)

  if (!sorted.length) return { orientation: 'unknown', confidence: 0, cw: 0, ccw: 0 }

  let cw = 0
  let ccw = 0
  for (const r of sorted) (signedArea(r) > 0 ? cw++ : ccw++)

  const total = cw + ccw
  const orientation = cw >= ccw ? 'cw' : 'ccw'
  const confidence = Math.max(cw, ccw) / total
  return { orientation, confidence, cw, ccw }
}

/** tile 像素坐标 -> 经纬度 */
export function tileToLonLat(tx, ty, z, extent, [px, py]) {
  const size = 2 ** z
  const lon = ((tx + px / extent) / size) * 360 - 180
  const n = Math.PI * (1 - (2 * (ty + py / extent)) / size)
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI
  return [lon, lat]
}

// ---------- 自测：人为破坏绕向，验证能否检出并修回 ----------

function selfTest() {
  // 外环（CW，正面积）+ 内部一个孔洞（CCW，负面积）
  const exterior = [[0, 0], [100, 0], [100, 100], [0, 100]] // CW in y-down
  const hole = [[25, 25], [25, 75], [75, 75], [75, 25]] // CCW in y-down

  console.log('自测 1 — 合规瓦片（外环 CW + 孔洞 CCW）')
  let items = classifyRings([exterior, hole])
  console.log(`  外环面积=${items[0].area.toFixed(0)} 应为外环=${items[0].shouldBeExterior} 合规=${items[0].conforms}`)
  console.log(`  孔洞面积=${items[1].area.toFixed(0)} 应为外环=${items[1].shouldBeExterior} 合规=${items[1].conforms}`)

  console.log('\n自测 2 — 违规瓦片（两个环都是 CCW，模拟 PostGIS 未 ST_ForcePolygonCW）')
  items = classifyRings([[...exterior].reverse(), hole])
  console.log(`  外环面积=${items[0].area.toFixed(0)} 应为外环=${items[0].shouldBeExterior} 合规=${items[0].conforms}`)
  console.log(`  孔洞面积=${items[1].area.toFixed(0)} 应为外环=${items[1].shouldBeExterior} 合规=${items[1].conforms}`)

  const fixed = fixRings([[...exterior].reverse(), hole])
  const after = classifyRings(fixed.rings)
  console.log(`  修正后：反转 ${fixed.reversed} 个环，全部合规=${after.every((i) => i.conforms)}`)
  console.log(`  修正后外环面积=${after[0].area.toFixed(0)}（已翻转为正）`)
}

// ---------- CLI 报告 ----------

const isCli = process.argv[1] && process.argv[1].endsWith('decode.mjs')
if (isCli) {
  if (process.argv.includes('--selftest')) {
    selfTest()
  } else {
    const { readFileSync } = await import('node:fs')
    const file = process.argv[2] || 'sample-z2.pbf'
    const buf = readFileSync(file)
    const layers = decodeTile(buf)
    const [, tz, tx, ty] = (file.match(/(\d+)\/(\d+)\/(\d+)/) ?? ['', 2, 2, 1]).map(Number)

    console.log(`瓦片: ${file}  (${buf.length} bytes)  z=${tz} x=${tx} y=${ty}`)
    console.log(`图层数: ${layers.length}\n`)

    let totalFeatures = 0
    let totalRings = 0
    let exteriors = 0
    let holes = 0
    let violations = 0
    let sampleLonLat = null

    for (const layer of layers) {
      const byType = {}
      for (const f of layer.features) byType[f.type] = (byType[f.type] ?? 0) + 1
      totalFeatures += layer.features.length

      const parts = Object.entries(byType).map(([t, c]) => `${t}:${c}`).join('  ')
      console.log(`  [${layer.name}]  extent=${layer.extent}  v${layer.version}  ${parts}`)

      const polys = layer.features.filter((f) => f.type === 'polygon')
      if (!polys.length) continue

      let lExt = 0
      let lHole = 0
      let lBad = 0
      const allRings = []
      const badSamples = []
      for (const f of polys) {
        const items = classifyRings(f.geometry)
        for (const it of items) {
          totalRings++
          allRings.push(it.ring)
          it.shouldBeExterior ? lExt++ : lHole++
          if (!it.conforms) {
            lBad++
            if (badSamples.length < 3) {
              badSamples.push(
                `area=${it.area.toFixed(1)} depth=${it.depth} 应为${it.shouldBeExterior ? '外环' : '孔洞'} 实际${it.actualIsExterior ? 'CW' : 'CCW'}`
              )
            }
          }
        }
        if (!sampleLonLat && f.geometry[0]?.length >= 3) {
          sampleLonLat = f.geometry[0]
            .slice(0, 3)
            .map((p) => tileToLonLat(tx, ty, tz, layer.extent, p))
        }
      }
      exteriors += lExt
      holes += lHole
      violations += lBad

      const orient = detectTileOrientation(allRings)
      console.log(`     外环 ${lExt}  孔洞 ${lHole}`)
      console.log(
        `     逐环包含判定违规: ${lBad}  |  整瓦片多数表决: ${orient.orientation.toUpperCase()} ` +
          `(CW ${orient.cw} : CCW ${orient.ccw}, 置信度 ${(orient.confidence * 100).toFixed(0)}%)`
      )
      if (badSamples.length) {
        console.log(`     疑似误判样本:`)
        for (const s of badSamples) console.log(`       · ${s}`)
      }
    }

    console.log(`\n合计: ${totalFeatures} 要素, ${totalRings} 个环（外环 ${exteriors} / 孔洞 ${holes}）`)
    console.log(`绕向违规: ${violations} 个环${violations === 0 ? ' —— 本瓦片完全符合 MVT 规范' : ' —— 需修正后才能交给 ArcGIS 原生剖分'}`)

    if (sampleLonLat) {
      console.log('\n坐标可用性验证（前 3 个顶点已转为经纬度）:')
      for (const [lon, lat] of sampleLonLat) {
        console.log(`  [${lon.toFixed(4)}, ${lat.toFixed(4)}]`)
      }
    }
  }
}
