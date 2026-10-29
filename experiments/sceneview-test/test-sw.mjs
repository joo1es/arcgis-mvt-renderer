/**
 * 对构建产物 mvt-sw.js 做端到端验证（无需浏览器）
 *
 * 做法：伪造 Service Worker 全局作用域 → 加载真实 IIFE 产物 →
 * 触发 message 下发规则 → 派发 fetch 事件 → 校验响应头与瓦片绕向。
 *
 * 前置：本地静态服务器需在 127.0.0.1:5199 运行（node serve.mjs 5199）
 * 运行：node test-sw.mjs
 */
import { readFileSync } from 'node:fs'
import { decodeTile, signedArea } from '../mvt-parser/decode.mjs'

const ORIGIN = 'http://127.0.0.1:5199'

const handlers = {}
globalThis.self = {
  addEventListener: (type, handler) => { handlers[type] = handler },
  skipWaiting: () => {},
  clients: { claim: async () => {} },
}

await import('./mvt-sw.js')
console.log('SW 产物已加载，注册的处理器:', Object.keys(handlers).join(', '))

handlers.message({
  data: { type: 'set-patterns', patterns: ['/tiles/live/'] },
  source: { postMessage: () => {} },
})
console.log('已下发拦截规则: /tiles/live/')

async function dispatch(url) {
  const req = new Request(url)
  let pending
  handlers.fetch({
    request: req,
    respondWith: (p) => { pending = p },
  })
  if (!pending) return null
  return await pending
}

function windingOf(bytes) {
  const layers = decodeTile(Buffer.from(bytes))
  const rings = layers
    .flatMap((l) => l.features.filter((f) => f.type === 'polygon'))
    .flatMap((f) => f.geometry)
    .filter((r) => r.length >= 3)
  let cw = 0
  let ccw = 0
  for (const r of rings) (signedArea(r) > 0 ? cw++ : ccw++)
  return { rings: rings.length, cw, ccw }
}

console.log('\n--- 1) 违规瓦片（应被拦截并修正）---')
const fixed = await dispatch(`${ORIGIN}/tiles/live/2/2/1.pbf`)
if (!fixed) {
  console.log('  未被拦截（规则不匹配）')
} else {
  const bytes = new Uint8Array(await fixed.arrayBuffer())
  const w = windingOf(bytes)
  console.log(`  HTTP ${fixed.status}  标记=${fixed.headers.get('x-mvt-winding')}  ${bytes.length} bytes`)
  console.log(`  环数=${w.rings}  CW:${w.cw}  CCW:${w.ccw}`)
  const original = windingOf(readFileSync(new URL('./tiles/bad/2/2/1.pbf', import.meta.url)))
  console.log(`  原始违规瓦片 CW:${original.cw} CCW:${original.ccw} → 修正后 CW:${w.cw} CCW:${w.ccw}`)
  console.log(`  绕向已翻转: ${w.cw === original.ccw && w.ccw === original.cw}`)
}

console.log('\n--- 2) 不在规则内的瓦片（应原样放行）---')
const passthrough = await dispatch(`${ORIGIN}/tiles/bad/2/2/1.pbf`)
console.log(`  ${passthrough ? '被拦截' : '未拦截（符合预期，规则只匹配 /tiles/live/）'}`)

console.log('\n--- 3) 二次请求（应命中 SW 内存缓存）---')
const cached = await dispatch(`${ORIGIN}/tiles/live/2/2/1.pbf`)
console.log(`  标记=${cached?.headers.get('x-mvt-winding')}`)

console.log('\n--- 4) 统计上报 ---')
let statsPayload = null
handlers.message({
  data: { type: 'get-stats' },
  source: { postMessage: (m) => { statsPayload = m } },
})
console.log('  ', JSON.stringify(statsPayload))
