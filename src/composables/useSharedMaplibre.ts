/* eslint-disable @typescript-eslint/no-explicit-any */
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'

interface SharedMaplibreEntry {
  map: maplibregl.Map
  containerEl: HTMLDivElement
  refCount: number
  watchHandle: __esri.WatchHandle | null
  resizeObserver: ResizeObserver | null
  isLoaded: boolean
  loadCallbacks: Array<(map: maplibregl.Map) => void>
}

/**
 * 模块级/全局 View 单例共享池：
 * 以 ArcGIS View 实例作为弱引用键（WeakMap），同一个 View 无论渲染多少个 MvtRenderer 组件，
 * 全局始终严格共享 1 张 Canvas、1 个 MapLibre 实例与 1 个 WebGL 上下文，彻底规避 WebGL 上下文超限。
 */
const sharedMaplibrePool = new WeakMap<any, SharedMaplibreEntry>()

const MAPLIBRE_BASE_RES = 78271.51696402048

const resolutionToZoom = (resolution: number) => {
  const z = Math.log2(MAPLIBRE_BASE_RES / resolution)
  return Math.max(0, Math.min(24, z))
}

const normalizeLongitude = (targetLon: number, currentLon: number) => {
  let lon = targetLon
  while (lon - currentLon > 180) lon -= 360
  while (lon - currentLon < -180) lon += 360
  return lon
}

/**
 * 从单例池中获取或初始化该 View 对应的 MapLibre 实例
 */
export async function acquireSharedMaplibre(
  view: any,
  options?: any
): Promise<{
  map: maplibregl.Map
  release: () => void
}> {
  if (!view) {
    throw new Error('[arcgis-mvt-renderer] 无法获取 ArcGIS View 实例')
  }

  if (typeof view.when === 'function') {
    await view.when()
  }

  let entry = sharedMaplibrePool.get(view)

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

  // 1. 创建挂载容器
  const containerEl = document.createElement('div')
  containerEl.className = 'maplibre-provider-view maplibre-shared-singleton'
  containerEl.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;'

  const contentEl = document.createElement('div')
  contentEl.className = 'maplibre-provider-content'
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
    } else {
      root.appendChild(containerEl)
    }
    if (ui) {
      ui.style.zIndex = '1'
    }
  }

  // 坐标系检测与警告
  if (
    view.spatialReference &&
    !view.spatialReference.isWebMercator &&
    view.spatialReference.wkid !== 3857 &&
    view.spatialReference.wkid !== 102100
  ) {
    console.warn(
      `[arcgis-mvt-renderer] 当前 ArcGIS 视图坐标系为 WKID:${view.spatialReference.wkid}（非 Web 墨卡托 EPSG:3857）。\n` +
      `MapLibre GL 渲染管线基于 Web 墨卡托构建；若使用自定义投影，建议配置 engine="arcgis"。`
    )
  }

  // 3. 初始化 MapLibre GL 实例
  const map = new maplibregl.Map({
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
    ...options,
  })

  const syncMap = () => {
    if (!map || !view?.ready) return
    if (!view.center || !view.resolution) return
    if (view.type === '3d') return

    let targetLon = 0
    let targetLat = 0

    if (view.spatialReference?.isWebMercator && typeof view.center.x === 'number') {
      targetLon = (view.center.x / 20037508.342789244) * 180
    } else if (typeof view.center.longitude === 'number') {
      const currentLon = map.getCenter().lng
      targetLon = normalizeLongitude(view.center.longitude, currentLon)
    }

    if (typeof view.center.latitude === 'number') {
      targetLat = Math.max(-85.0511, Math.min(85.0511, view.center.latitude))
    }

    map.jumpTo({
      center: [targetLon, targetLat],
      zoom: resolutionToZoom(view.resolution),
      bearing: -(view.rotation ?? 0),
    })
  }

  // 4. 视角同步监听
  const watchHandle = reactiveUtils.watch(
    () => [view.center?.x, view.center?.y, view.resolution, view.rotation],
    () => {
      syncMap()
    },
    { sync: true }
  )

  // 5. 尺寸响应式监听
  const resizeObserver = new ResizeObserver(() => {
    if (map) {
      map.resize()
    }
  })
  resizeObserver.observe(containerEl)

  entry = {
    map,
    containerEl,
    refCount: 1,
    watchHandle,
    resizeObserver,
    isLoaded: false,
    loadCallbacks: [],
  }

  sharedMaplibrePool.set(view, entry)

  return new Promise((resolve) => {
    map.once('load', () => {
      if (entry) {
        entry.isLoaded = true
        syncMap()
        const release = createRelease(view, entry)
        resolve({ map, release })
        entry.loadCallbacks.forEach((cb) => cb(map))
        entry.loadCallbacks = []
      }
    })
  })
}

function createRelease(view: any, entry: SharedMaplibreEntry) {
  let released = false
  return () => {
    if (released) return
    released = true
    entry.refCount--

    if (entry.refCount <= 0) {
      entry.watchHandle?.remove()
      entry.resizeObserver?.disconnect()
      try {
        entry.map.remove()
      } catch {
        // ignore
      }
      entry.containerEl.remove()
      if (view?.ui?.container) {
        view.ui.container.style.zIndex = ''
      }
      sharedMaplibrePool.delete(view)
    }
  }
}
