import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'
import type { MvtEngineType } from '../types'

export interface SharedEngineOptions {
  engine?: MvtEngineType
  accessToken?: string
  engineInstance?: any
  mapOptions?: any
}

export interface DetectedEngineResult {
  engine: 'maplibre' | 'mapbox' | 'arcgis'
  lib?: any
}

interface SharedEngineEntry {
  map: any
  engineType: 'maplibre' | 'mapbox'
  containerEl: HTMLDivElement
  refCount: number
  watchHandle: __esri.WatchHandle | null
  resizeObserver: ResizeObserver | null
  isLoaded: boolean
  loadCallbacks: Array<(map: any) => void>
}

/**
 * 模块级/全局 View 单例共享池：
 * 以 ArcGIS View 实例作为弱引用键（WeakMap），同一个 View 无论渲染多少个 MvtRenderer / ArcGISMvtLayer，
 * 全局始终严格共享 1 张 Canvas 画布、1 个引擎实例与 1 个 WebGL 上下文，彻底规避 WebGL 上下文超限崩溃。
 */
const sharedEnginePool = new WeakMap<any, SharedEngineEntry>()

const MAP_BASE_RES = 78271.51696402048

const resolutionToZoom = (resolution: number) => {
  const z = Math.log2(MAP_BASE_RES / resolution)
  return Math.max(0, Math.min(24, z))
}

const normalizeLongitude = (targetLon: number, currentLon: number) => {
  let lon = targetLon
  while (lon - currentLon > 180) lon -= 360
  while (lon - currentLon < -180) lon += 360
  return lon
}

/**
 * 智能自动探测当前环境中安装并可用的渲染引擎
 */
export async function detectAvailableEngine(
  preferredEngine: MvtEngineType = 'auto',
  options?: SharedEngineOptions
): Promise<DetectedEngineResult> {
  // 1. 显式传入了外部引擎库实例
  if (options?.engineInstance) {
    const engineName = preferredEngine === 'mapbox' ? 'mapbox' : 'maplibre'
    return { engine: engineName, lib: options.engineInstance }
  }

  // 2. 显式指定 'arcgis' 原生模式
  if (preferredEngine === 'arcgis') {
    return { engine: 'arcgis' }
  }

  const tryLoadMaplibre = async () => {
    if (typeof window !== 'undefined' && (window as any).maplibregl) {
      return (window as any).maplibregl
    }
    if (maplibregl) {
      return maplibregl
    }
    try {
      const pkg = 'maplibre-gl'
      const mod = await import(/* @vite-ignore */ pkg)
      return mod.default || mod
    } catch {
      return null
    }
  }

  const tryLoadMapbox = async () => {
    if (typeof window !== 'undefined' && (window as any).mapboxgl) {
      return (window as any).mapboxgl
    }
    try {
      const pkg = 'mapbox-gl'
      const mod = await import(/* @vite-ignore */ pkg)
      return mod.default || mod
    } catch {
      return null
    }
  }

  // 3. 显式指定 'maplibre'
  if (preferredEngine === 'maplibre') {
    const lib = await tryLoadMaplibre()
    if (!lib) {
      throw new Error(
        '[arcgis-mvt-renderer] 指定了 engine="maplibre"，但在当前环境中未找到 maplibre-gl。\n' +
        '请运行 `pnpm add maplibre-gl` 安装，或使用默认的 engine="auto"。'
      )
    }
    return { engine: 'maplibre', lib }
  }

  // 4. 显式指定 'mapbox'
  if (preferredEngine === 'mapbox') {
    const lib = await tryLoadMapbox()
    if (!lib) {
      throw new Error(
        '[arcgis-mvt-renderer] 指定了 engine="mapbox"，但在当前环境中未找到 mapbox-gl。\n' +
        '请运行 `pnpm add mapbox-gl` 安装，或使用默认的 engine="auto"。'
      )
    }
    return { engine: 'mapbox', lib }
  }

  // 5. 'auto' 自动档智能探测：
  // 5.1 若传入了 accessToken，优先检测 mapbox-gl
  if (options?.accessToken) {
    const mapboxLib = await tryLoadMapbox()
    if (mapboxLib) {
      return { engine: 'mapbox', lib: mapboxLib }
    }
  }

  // 5.2 默认优先检测开源 maplibre-gl
  const maplibreLib = await tryLoadMaplibre()
  if (maplibreLib) {
    return { engine: 'maplibre', lib: maplibreLib }
  }

  // 5.3 尝试检测 mapbox-gl
  const mapboxLib = await tryLoadMapbox()
  if (mapboxLib) {
    return { engine: 'mapbox', lib: mapboxLib }
  }

  // 5.4 两者均未安装，安全降级到 arcgis 原生模式
  console.warn(
    '[arcgis-mvt-renderer] engine="auto" 自动检测：未找到 maplibre-gl 或 mapbox-gl 依赖，已自动安全降级至 ArcGIS 原生模式。\n' +
    '提示：ArcGIS 原生模式对第三方逆时针 (CCW) 多边形面瓦片存在丢弃缺陷，推荐安装 maplibre-gl: `pnpm add maplibre-gl`'
  )
  return { engine: 'arcgis' }
}

/**
 * 从单例池中获取或初始化该 View 对应的 MapLibre / Mapbox 引擎实例
 */
export async function acquireSharedEngine(
  view: any,
  options?: SharedEngineOptions
): Promise<{
  map: any
  engine: 'maplibre' | 'mapbox'
  release: () => void
}> {
  if (!view) {
    throw new Error('[arcgis-mvt-renderer] 无法获取 ArcGIS View 实例')
  }

  if (typeof view.when === 'function') {
    await view.when()
  }

  const detected = await detectAvailableEngine(options?.engine || 'auto', options)
  if (detected.engine === 'arcgis' || !detected.lib) {
    throw new Error('[arcgis-mvt-renderer] 当前处于 ArcGIS 原生模式，无需初始化 WebGL 引擎画布')
  }

  const engineType = detected.engine
  const engineLib = detected.lib

  let entry = sharedEnginePool.get(view)

  if (entry) {
    entry.refCount++
    if (entry.isLoaded) {
      return {
        map: entry.map,
        engine: entry.engineType,
        release: createRelease(view, entry),
      }
    } else {
      return new Promise((resolve) => {
        entry!.loadCallbacks.push((m) => {
          resolve({
            map: m,
            engine: entry!.engineType,
            release: createRelease(view, entry!),
          })
        })
      })
    }
  }

  if (options?.accessToken && engineLib) {
    engineLib.accessToken = options.accessToken
  }

  // 1. 创建挂载容器
  const containerEl = document.createElement('div')
  containerEl.className = `mvt-engine-provider-view mvt-shared-singleton mvt-engine-${engineType}`
  containerEl.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;'

  const contentEl = document.createElement('div')
  contentEl.className = 'mvt-engine-provider-content'
  contentEl.style.cssText = 'width:100%;height:100%;'
  containerEl.appendChild(contentEl)

  // 2. 挂载到 ArcGIS view.root 内部且置于 .esri-ui 之下
  const root =
    view.root ||
    (view.container && view.container.querySelector
      ? view.container.querySelector('.esri-view-root')
      : null) ||
    view.container

  const ui =
    view.ui?.container ||
    (root && root.querySelector ? root.querySelector('.esri-ui') : null)

  if (root) {
    if (ui && ui.parentElement === root) {
      root.insertBefore(containerEl, ui)
      ui.style.zIndex = '1'
    } else {
      root.appendChild(containerEl)
    }
  }

  // 3. 初始化 Map 实例
  const map = new engineLib.Map({
    container: contentEl,
    style: {
      version: 8,
      sources: {},
      layers: [],
    },
    attributionControl: false,
    fadeDuration: 0,
    interactive: false,
    renderWorldCopies: true,
    canvasContextAttributes: {
      preserveDrawingBuffer: true,
    },
    ...options?.mapOptions,
  })

  entry = {
    map,
    engineType,
    containerEl,
    refCount: 1,
    watchHandle: null,
    resizeObserver: null,
    isLoaded: false,
    loadCallbacks: [],
  }
  sharedEnginePool.set(view, entry)

  // 4. 视角同步函数
  const syncMap = () => {
    if (!map || !view.center || !view.resolution) return
    const currentCenter = map.getCenter ? map.getCenter() : null
    const currentLon = currentCenter ? currentCenter.lng : view.center.longitude
    const normLon = normalizeLongitude(view.center.longitude, currentLon)

    map.jumpTo({
      center: [normLon, view.center.latitude],
      zoom: resolutionToZoom(view.resolution),
      bearing: -view.rotation,
    })
  }

  // 5. 监听地图加载完成
  const currentEntry = entry
  return new Promise((resolve) => {
    map.once('load', () => {
      syncMap()

      // 实时视角监听
      currentEntry.watchHandle = reactiveUtils.watch(
        () => [
          view.center?.x,
          view.center?.y,
          view.resolution,
          view.rotation,
        ],
        () => {
          syncMap()
        },
        { sync: true }
      )

      // 视口尺寸监听 (标准 ResizeObserver，零额外依赖)
      if (typeof ResizeObserver !== 'undefined') {
        currentEntry.resizeObserver = new ResizeObserver(() => {
          if (map) map.resize()
        })
        currentEntry.resizeObserver.observe(containerEl)
      }

      currentEntry.isLoaded = true
      currentEntry.loadCallbacks.forEach((cb) => cb(map))
      currentEntry.loadCallbacks = []

      resolve({
        map,
        engine: engineType,
        release: createRelease(view, currentEntry),
      })
    })
  })
}

/**
 * 保持向后兼容的原有导出命名
 */
export async function acquireSharedMaplibre(
  view: any,
  options?: any
): Promise<{
  map: any
  release: () => void
}> {
  return acquireSharedEngine(view, { engine: 'maplibre', ...options })
}

/**
 * 引用计数回收销毁
 */
function createRelease(view: any, entry: SharedEngineEntry) {
  let released = false
  return () => {
    if (released) return
    released = true
    entry.refCount--

    if (entry.refCount <= 0) {
      sharedEnginePool.delete(view)
      entry.watchHandle?.remove()
      entry.resizeObserver?.disconnect()

      try {
        entry.map?.remove()
      } catch (e) {
        console.warn('[arcgis-mvt-renderer] 销毁共享引擎实例时提示:', e)
      }

      if (entry.containerEl?.parentElement) {
        entry.containerEl.parentElement.removeChild(entry.containerEl)
      }
    }
  }
}
