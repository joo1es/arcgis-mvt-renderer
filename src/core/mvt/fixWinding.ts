/**
 * MVT 绕向修正器（零依赖）
 *
 * 只做一件事：把瓦片里 polygon 的环绕向修正为 MVT 规范要求的
 * 「外环 CW / 孔洞 CCW」，使 ArcGIS 原生 VectorTileLayer（含 SceneView）
 * 能够正常三角剖分。
 *
 * 设计要点：
 * 1. 不解析 properties / values / keys —— 那些字节原样透传，
 *    因此完全不需要实现 Value 的 7 种类型序列化。
 * 2. 判定用「整瓦片多数表决」而非逐环包含判定 —— 相邻要素共享边界顶点，
 *    射线法在真实数据上有约 2% 误判率。
 * 3. 修正后自底向上重算长度前缀（Tile → Layer → Feature）。
 */

const MOVE_TO = 1
const LINE_TO = 2
const CLOSE_PATH = 7
const GEOM_POLYGON = 3

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  let byte: number
  do {
    byte = buf[pos++]
    result += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80)
  return [result, pos]
}

function writeVarint(value: number): number[] {
  const out: number[] = []
  let v = value
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

const unzigzag = (n: number) => (n >>> 1) ^ -(n & 1)
const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1)

/** 遍历一段 protobuf 消息的所有字段，回调可返回新 payload 以替换 */
function rebuild(
  buf: Uint8Array,
  replace: (field: number, wire: number, payload: Uint8Array) => Uint8Array | undefined
): Uint8Array {
  const out: number[] = []
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = readVarint(buf, pos)
    const field = key >>> 3
    const wire = key & 7
    out.push(...writeVarint(key))

    if (wire === 0) {
      let v: number
      ;[v, pos] = readVarint(buf, pos)
      out.push(...writeVarint(v))
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      const raw = buf.subarray(pos, pos + len)
      pos += len
      const payload = replace(field, wire, raw) ?? raw
      out.push(...writeVarint(payload.length), ...payload)
    } else if (wire === 1) {
      out.push(...buf.subarray(pos, pos + 8))
      pos += 8
    } else if (wire === 5) {
      out.push(...buf.subarray(pos, pos + 4))
      pos += 4
    } else {
      throw new Error(`不支持的 wire type ${wire}`)
    }
  }
  return Uint8Array.from(out)
}

/** 几何指令流 -> 环数组（tile 坐标，y 向下） */
function decodeRings(payload: Uint8Array): number[][][] {
  const cmds: number[] = []
  let p = 0
  while (p < payload.length) {
    let v: number
    ;[v, p] = readVarint(payload, p)
    cmds.push(v)
  }

  const rings: number[][][] = []
  let x = 0
  let y = 0
  let ring: number[][] | null = null
  let i = 0

  while (i < cmds.length) {
    const cmd = cmds[i++]
    const id = cmd & 7
    const count = cmd >>> 3
    if (id === MOVE_TO) {
      for (let k = 0; k < count; k++) {
        x += unzigzag(cmds[i++])
        y += unzigzag(cmds[i++])
        ring = [[x, y]]
        rings.push(ring)
      }
    } else if (id === LINE_TO) {
      for (let k = 0; k < count; k++) {
        x += unzigzag(cmds[i++])
        y += unzigzag(cmds[i++])
        ring?.push([x, y])
      }
    } else if (id !== CLOSE_PATH) {
      throw new Error(`非法几何指令 ${id}`)
    }
  }
  return rings
}

/** 环数组 -> 几何指令流（坐标游标跨环连续） */
function encodeRings(rings: number[][][]): Uint8Array {
  const cmds: number[] = []
  let cx = 0
  let cy = 0

  for (const ring of rings) {
    if (!ring.length) continue
    cmds.push((1 << 3) | MOVE_TO, zigzag(ring[0][0] - cx), zigzag(ring[0][1] - cy))
    cx = ring[0][0]
    cy = ring[0][1]
    if (ring.length > 1) {
      cmds.push(((ring.length - 1) << 3) | LINE_TO)
      for (let i = 1; i < ring.length; i++) {
        cmds.push(zigzag(ring[i][0] - cx), zigzag(ring[i][1] - cy))
        cx = ring[i][0]
        cy = ring[i][1]
      }
    }
    cmds.push((1 << 3) | CLOSE_PATH)
  }
  return Uint8Array.from(cmds.flatMap(writeVarint))
}

/** 鞋带公式；y 向下坐标系中正面积 = 顺时针 CW */
function signedArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return sum / 2
}

function readFeatureType(buf: Uint8Array): number {
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = readVarint(buf, pos)
    const field = key >>> 3
    const wire = key & 7
    if (wire === 0) {
      let v: number
      ;[v, pos] = readVarint(buf, pos)
      if (field === 3) return v
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      pos += len
    } else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw new Error(`不支持的 wire type ${wire}`)
  }
  return 0
}

export interface FixResult {
  data: Uint8Array
  action: 'unchanged' | 'reversed'
  /** 参与表决的外环样本数 / 一致性 */
  sample: { cw: number; ccw: number; confidence: number }
  /** 环总数（仅 polygon） */
  rings: number
}

/**
 * 修正瓦片绕向。
 * @param input 原始瓦片字节
 * @param sampleSize 表决样本数，默认取面积最大的 20 个环
 */
export function fixTileWinding(input: ArrayBuffer | Uint8Array, sampleSize = 20): FixResult {
  const tile = input instanceof Uint8Array ? input : new Uint8Array(input)

  const areas: number[] = []
  let ringCount = 0

  const scan = (layerBuf: Uint8Array) =>
    rebuild(layerBuf, (field, _wire, payload) => {
      if (field !== 2 || readFeatureType(payload) !== GEOM_POLYGON) return undefined
      rebuild(payload, (f, _w, geom) => {
        if (f !== 4) return undefined
        for (const ring of decodeRings(geom)) {
          if (ring.length < 3) continue
          ringCount++
          areas.push(Math.abs(signedArea(ring)) * (signedArea(ring) > 0 ? 1 : -1))
        }
        return undefined
      })
      return undefined
    })

  rebuild(tile, (field, _wire, payload) => {
    if (field === 3) scan(payload)
    return undefined
  })

  const sampleAreas = areas
    .slice()
    .sort((a, b) => Math.abs(b) - Math.abs(a))
    .slice(0, sampleSize)

  let cw = 0
  let ccw = 0
  for (const a of sampleAreas) (a > 0 ? cw++ : ccw++)

  const confidence = sampleAreas.length ? Math.max(cw, ccw) / sampleAreas.length : 0

  if (!sampleAreas.length || cw >= ccw) {
    return { data: tile, action: 'unchanged', sample: { cw, ccw, confidence }, rings: ringCount }
  }

  const flipped = rebuild(tile, (field, _wire, layerPayload) => {
    if (field !== 3) return undefined
    return rebuild(layerPayload, (lField, _w, featurePayload) => {
      if (lField !== 2 || readFeatureType(featurePayload) !== GEOM_POLYGON) return undefined
      return rebuild(featurePayload, (fField, _fw, geom) => {
        if (fField !== 4) return undefined
        return encodeRings(decodeRings(geom).map((r) => [...r].reverse()))
      })
    })
  })

  return {
    data: flipped,
    action: 'reversed',
    sample: { cw, ccw, confidence },
    rings: ringCount,
  }
}

export default fixTileWinding
