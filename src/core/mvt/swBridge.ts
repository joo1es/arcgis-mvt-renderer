/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Service Worker 瓦片修正器注册桥接
 *
 * 负责：能力检测 → 注册 → 等待控制器接管 → 下发 URL 匹配规则 → 统计上报。
 * 同一组 (swUrl, scope) 全局只注册一次，多个图层共享同一个实例。
 */

export interface TileFixerOptions {
  /** Service Worker 脚本地址，默认 '/mvt-sw.js' */
  swUrl?: string
  /** 作用域，默认 '/' */
  scope?: string
  /** 额外的瓦片 URL 匹配规则（默认已覆盖 *.pbf 与 /mvt 路径） */
  patterns?: (string | RegExp)[]
  /** 等待 SW 接管页面的超时（毫秒），默认 8000 */
  timeout?: number
  /** 静默模式：注册失败时不打印错误（用于 engine="auto" 的探测性注册） */
  silent?: boolean
}

export interface FixStats {
  seen: number
  fixed: number
  unchanged: number
  skipped: number
  errors: number
}

export interface TileFixerHandle {
  supported: boolean
  active: boolean
  reason?: string
  registration: ServiceWorkerRegistration | null
  setPatterns: (patterns: (string | RegExp)[]) => void
  getStats: () => Promise<{ stats: FixStats; cached: number } | null>
  unregister: () => Promise<void>
}

const registry = new Map<string, Promise<TileFixerHandle>>()

function unsupported(reason: string): TileFixerHandle {
  return {
    supported: false,
    active: false,
    reason,
    registration: null,
    setPatterns: () => {},
    getStats: async () => null,
    unregister: async () => {},
  }
}

function waitForController(timeout: number): Promise<boolean> {
  if (navigator.serviceWorker.controller) return Promise.resolve(true)

  return new Promise((resolve) => {
    let done = false
    const finish = (value: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(value)
    }
    const onChange = () => finish(true)
    const timer = setTimeout(() => finish(!!navigator.serviceWorker.controller), timeout)

    navigator.serviceWorker.addEventListener('controllerchange', onChange)
  })
}

function normalizePatterns(patterns: (string | RegExp)[]): string[] {
  return patterns.map((p) => (p instanceof RegExp ? p.source : p))
}

/** 预检脚本是否可访问，避免未部署时产生 SW 注册失败的浏览器噪音 */
async function swScriptAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

async function create(opts: TileFixerOptions): Promise<TileFixerHandle> {
  const swUrl = opts.swUrl ?? '/mvt-sw.js'
  const scope = opts.scope ?? '/'
  const timeout = opts.timeout ?? 8000

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return unsupported('当前环境不支持 Service Worker')
  }

  const secure =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname))

  if (!secure) {
    return unsupported('Service Worker 需要 HTTPS 或 localhost 环境')
  }

  if (!(await swScriptAvailable(swUrl))) {
    return unsupported(`未找到 Service Worker 脚本 ${swUrl}`)
  }

  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.register(swUrl, { scope })
  } catch (e: any) {
    const message = `注册失败: ${e?.message ?? e}`
    if (!opts.silent) {
      console.error(
        `[arcgis-mvt-renderer] 注册瓦片修正 Service Worker 失败 (${swUrl})。\n` +
          `请确认已将 dist/mvt-sw.js 复制到应用同源静态目录，且路径可访问。\n` +
          `原因: ${e?.message ?? e}`
      )
    }
    return unsupported(message)
  }

  const controlled = await waitForController(timeout)

  if (!controlled && !opts.silent) {
    console.warn(
      '[arcgis-mvt-renderer] Service Worker 已注册但尚未接管当前页面，' +
        '瓦片绕向修正可能暂未生效。刷新页面后即可正常。'
    )
  }

  const post = (msg: any) => {
    const target = navigator.serviceWorker.controller ?? registration.active
    target?.postMessage(msg)
  }

  if (opts.patterns?.length) post({ type: 'set-patterns', patterns: normalizePatterns(opts.patterns) })

  const handle: TileFixerHandle = {
    supported: true,
    active: controlled,
    registration,
    setPatterns: (patterns) => post({ type: 'set-patterns', patterns: normalizePatterns(patterns) }),
    getStats: () =>
      new Promise((resolve) => {
        const target = navigator.serviceWorker.controller ?? registration.active
        if (!target) return resolve(null)

        const channel = new MessageChannel()
        const timer = setTimeout(() => resolve(null), 3000)

        channel.port1.onmessage = (e) => {
          clearTimeout(timer)
          resolve(e.data?.stats ? { stats: e.data.stats, cached: e.data.cached ?? 0 } : null)
        }
        target.postMessage({ type: 'get-stats' }, [channel.port2])
      }),
    unregister: async () => {
      try {
        await registration.unregister()
      } catch {
        /* 忽略 */
      }
    },
  }

  return handle
}

/**
 * 确保瓦片修正 Service Worker 已注册并生效。
 * 相同 (swUrl, scope) 会复用同一个 Promise，避免重复注册。
 */
export function ensureTileFixer(opts: TileFixerOptions = {}): Promise<TileFixerHandle> {
  const key = `${opts.swUrl ?? '/mvt-sw.js'}|${opts.scope ?? '/'}`

  let pending = registry.get(key)
  if (!pending) {
    pending = create(opts).catch((e) => unsupported(`初始化异常: ${e?.message ?? e}`))
    registry.set(key, pending)
  }
  return pending
}

/** 清除注册缓存（仅用于测试或强制重新注册） */
export function resetTileFixerRegistry(): void {
  registry.clear()
}
