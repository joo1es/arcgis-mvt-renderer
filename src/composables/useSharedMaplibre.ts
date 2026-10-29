/* eslint-disable @typescript-eslint/no-explicit-any */
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'
import { MAPLIBRE_GLOBAL_KEY } from '../core/engineKeys'
import type { MvtEngineType } from '../types'

/**
 * 外部注入的引擎库实例。
 *
 * 本库**不在构建期依赖 maplibre-gl / mapbox-gl**：
 * 主入口不产生任何对它们的 import 语句，因此未使用这两个引擎的项目
 * 无需安装它们即可正常打包。
 *
 * 启用方式（三选一）：
 * 1. `import 'arcgis-mvt-renderer/maplibre'`（推荐，自动注册并带上样式）
 * 2. `setMaplibre(maplibregl)` / `setMapbox(mapboxgl)` 手动注册
 * 3. 通过 `engineInstance` 选项逐个图层传入
 */
const injectedEngines: { maplibre: any; mapbox: any } = { maplibre: null, mapbox: null }

/** 注册 MapLibre GL 实例（全局生效） */
export function setMaplibre(lib: any): void {
  injectedEngines.maplibre = lib
}

/** 注册 Mapbox GL 实例（全局生效） */
export function setMapbox(lib: any): void {
  injectedEngines.mapbox = lib
}

/** 子入口 `arcgis-mvt-renderer/maplibre` 通过该全局键完成交接，避免共享 chunk */
export { MAPLIBRE_GLOBAL_KEY }

/** 解析可用的 MapLibre 实例：注入 → 全局交接 → window 全局 → 动态 import */
export async function loadMaplibreLib(): Promise<any | null> {
  if (injectedEngines.maplibre) return injectedEngines.maplibre

  const g = globalThis as any
  if (g[MAPLIBRE_GLOBAL_KEY]) return g[MAPLIBRE_GLOBAL_KEY]
  if (typeof window !== 'undefined' && (window as any).maplibregl) return (window as any).maplibregl

  try {
    // 刻意构造不可被构建期静态分析的 specifier：
    // 若写成字面量 import('maplibre-gl')，消费者的打包器会强制解析该依赖，
    // 未安装 maplibre-gl 的项目将直接构建失败，违背「主入口零依赖」的承诺。
    // 因此这里只在 CDN / importmap 等运行时可解析的场景生效；
    // 经过打包器处理的项目请使用 `import 'arcgis-mvt-renderer/maplibre'`。
    const pkg = ['maplibre', 'gl'].join('-')
    const mod = await import(/* @vite-ignore */ pkg)
    return (mod as any).default || mod
  } catch {
    return null
  }
}

/** 解析可用的 Mapbox GL 实例 */
export async function loadMapboxLib(): Promise<any | null> {
  if (injectedEngines.mapbox) return injectedEngines.mapbox
  if (typeof window !== 'undefined' && (window as any).mapboxgl) return (window as any).mapboxgl

  try {
    const pkg = ['mapbox', 'gl'].join('-')
    const mod = await import(/* @vite-ignore */ pkg)
    return (mod as any).default || mod
  } catch {
    return null
  }
}

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

  // 2. 显式指定 'arcgis' 原生模式 / 'native-fixed' 原生修正模式
  if (preferredEngine === 'arcgis' || preferredEngine === 'native-fixed') {
    return { engine: 'arcgis' }
  }

  const tryLoadMaplibre = loadMaplibreLib
  const tryLoadMapbox = loadMapboxLib

  // 3. 显式指定 'maplibre'
  if (preferredEngine === 'maplibre') {
    const lib = await tryLoadMaplibre()
    if (!lib) {
      throw new Error(
        '[arcgis-mvt-renderer] 指定了 engine="maplibre"，但当前环境中没有可用的 maplibre-gl。\n' +
        '请安装后添加一行注册：\n' +
        "  import 'maplibre-gl/dist/maplibre-gl.css'\n" +
        "  import 'arcgis-mvt-renderer/maplibre'\n" +
        '或改用 engine="native-fixed"（无需 MapLibre 即可修复面填充）。'
      )
    }
    return { engine: 'maplibre', lib }
  }

  // 4. 显式指定 'mapbox'
  if (preferredEngine === 'mapbox') {
    const lib = await tryLoadMapbox()
    if (!lib) {
      throw new Error(
        '[arcgis-mvt-renderer] 指定了 engine="mapbox"，但当前环境中没有可用的 mapbox-gl。\n' +
        '请安装后添加一行注册：\n' +
        "  import 'mapbox-gl/dist/mapbox-gl.css'\n" +
        '  import maplibregl from "mapbox-gl"\n' +
        '  import { setMapbox } from "arcgis-mvt-renderer"\n' +
        '  setMapbox(maplibregl)'
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
