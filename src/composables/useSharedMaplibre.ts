/* eslint-disable @typescript-eslint/no-explicit-any */
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'

export interface SharedEngineOptions {
  engine?: 'maplibre' | 'mapbox' | 'arcgis'
  accessToken?: string
  engineInstance?: any
  mapOptions?: any
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
 * 动态加载并解析地图引擎库 (MapLibre GL 或 Mapbox GL)
 */
async function resolveEngineLib(options?: SharedEngineOptions): Promise<any> {
  if (options?.engineInstance) {
    return options.engineInstance
  }

  if (options?.engine === 'mapbox') {
    if (typeof window !== 'undefined' && (window as any).mapboxgl) {
      return (window as any).mapboxgl
    }
    try {
      // 使用动态导入执行器，避免在宿主未安装 mapbox-gl 时 Vite 静态分析报 500 错误
      const dynamicImport = new Function('specifier', 'return import(specifier)')
      const mod = await dynamicImport('mapbox-gl')
      return mod.default || mod
    } catch {
      throw new Error(
        '[arcgis-mvt-renderer] 指定了 engine="mapbox"，但当前环境未找到 mapbox-gl 模块。\n' +
        '请在项目中运行 `pnpm add mapbox-gl`，或通过 `engineInstance` 参数传入 mapboxgl 实例。'
      )
    }
  }

  return maplibregl
}

/**
 * 从单例池中获取或初始化该 View 对应的 MapLibre / Mapbox 引擎实例
 */
export async function acquireSharedEngine(
  view: any,
  options?: SharedEngineOptions
): Promise<{
  map: any
  release: () => void
}> {
  if (!view) {
    throw new Error('[arcgis-mvt-renderer] 无法获取 ArcGIS View 实例')
  }

  if (typeof view.when === 'function') {
    await view.when()
  }

  let entry = sharedEnginePool.get(view)

  if (entry) {
    entry.refCount++
    if (entry.isLoaded) {
      return {
        map: entry.map,
        release: createRelease(view, entry),
      }
    } else {
      return new Promise((resolve) => {
        entry!.loadCallbacks.push((m) => {
          resolve({
            map: m,
            release: createRelease(view, entry!),
          })
        })
      })
    }
  }

  const engineType = options?.engine === 'mapbox' ? 'mapbox' : 'maplibre'
  const engineLib = await resolveEngineLib(options)

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
