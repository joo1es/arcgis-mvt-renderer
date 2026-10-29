/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MVT 瓦片绕向修正 Service Worker
 *
 * 部署方式：将构建产物 dist/mvt-sw.js 复制到应用同源静态目录的根路径
 * （例如 public/mvt-sw.js），随后由 arcgis-mvt-renderer 自动注册。
 *
 * 工作方式：拦截匹配的瓦片请求 → 拉取原始字节 → 修正 polygon 环绕向 →
 * 返回修正后的 Response。合规瓦片原样放行，零改动。
 */

import { fixTileWinding } from '../core/mvt/fixWinding'

interface SwEvent {
  waitUntil(promise: Promise<unknown>): void
}

interface SwFetchEvent extends SwEvent {
  request: Request
  respondWith(response: Response | Promise<Response>): void
}

interface SwMessageEvent {
  data: any
  source: { postMessage(message: any, transfer?: Transferable[]): void } | null
}

interface SwScope {
  addEventListener(type: 'install' | 'activate', handler: (event: SwEvent) => void): void
  addEventListener(type: 'fetch', handler: (event: SwFetchEvent) => void): void
  addEventListener(type: 'message', handler: (event: SwMessageEvent) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
}

const sw = self as unknown as SwScope

interface FixStats {
  seen: number
  fixed: number
  unchanged: number
  skipped: number
  errors: number
}

const stats: FixStats = { seen: 0, fixed: 0, unchanged: 0, skipped: 0, errors: 0 }

const DEFAULT_PATTERNS = [/\.pbf(\?|$)/i, /\/mvt(\/|\?|$)/i, /vector[-_]?tile/i]

let userPatterns: RegExp[] = []

/** 内存缓存：已修正瓦片（瓦片 URL 内容不变，可直接复用） */
const CACHE_LIMIT = 400
const fixedCache = new Map<string, ArrayBuffer>()

function remember(key: string, buf: ArrayBuffer) {
  if (fixedCache.size >= CACHE_LIMIT) {
    const oldest = fixedCache.keys().next().value
    if (oldest !== undefined) fixedCache.delete(oldest)
  }
  fixedCache.set(key, buf)
}

function shouldHandle(url: string): boolean {
  // 显式下发的规则优先，避免默认规则在调试/多源场景下误拦其它瓦片
  const patterns = userPatterns.length ? userPatterns : DEFAULT_PATTERNS
  return patterns.some((re) => re.test(url))
}

sw.addEventListener('install', () => {
  sw.skipWaiting()
})

sw.addEventListener('activate', (event: SwEvent) => {
  event.waitUntil(sw.clients.claim())
})

sw.addEventListener('message', (event: SwMessageEvent) => {
  const data = event.data as { type?: string; patterns?: string[] } | undefined

  if (data?.type === 'set-patterns' && Array.isArray(data.patterns)) {
    userPatterns = data.patterns.map((p) => {
      try {
        return new RegExp(p, 'i')
      } catch {
        return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      }
    })
    event.source?.postMessage({ type: 'patterns-set', count: userPatterns.length })
    return
  }

  if (data?.type === 'get-stats') {
    event.source?.postMessage({ type: 'stats', stats: { ...stats }, cached: fixedCache.size })
    return
  }

  if (data?.type === 'clear-cache') {
    fixedCache.clear()
  }
})

sw.addEventListener('fetch', (event: SwFetchEvent) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (req.headers.has('range')) return
  if (!shouldHandle(req.url)) return

  event.respondWith(handleTile(req))
})

async function handleTile(req: Request): Promise<Response> {
  stats.seen++

  const cached = fixedCache.get(req.url)
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-protobuf',
        'X-Mvt-Winding': 'cached',
        'X-Mvt-Winding-Detail': 'cached',
      },
    })
  }

  let res: Response
  try {
    res = await fetch(req)
  } catch {
    stats.errors++
    return Response.error()
  }

  if (!res.ok) {
    stats.skipped++
    return res
  }

  let buf: ArrayBuffer
  try {
    buf = await res.arrayBuffer()
  } catch {
    stats.errors++
    return res
  }

  let out = buf
  let marker = 'passthrough'
  let detail = 'not-parsed'

  try {
    const result = fixTileWinding(new Uint8Array(buf))
    detail = `${result.action} cw=${result.sample.cw} ccw=${result.sample.ccw} rings=${result.rings}`
    if (result.action === 'reversed') {
      const view = result.data
      out =
        view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
          ? (view.buffer as ArrayBuffer)
          : (view.slice().buffer as ArrayBuffer)
      marker = 'fixed'
      stats.fixed++
      remember(req.url, out)
    } else {
      stats.unchanged++
    }
  } catch (e) {
    // 非 MVT 载荷或解析失败：原样放行，绝不破坏数据
    detail = `error: ${(e as Error)?.message ?? e}`
    stats.skipped++
  }

  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.set('content-type', headers.get('content-type') || 'application/x-protobuf')
  headers.set('x-mvt-winding', marker)
  headers.set('x-mvt-winding-detail', detail)

  return new Response(out, { status: res.status, statusText: res.statusText, headers })
}
