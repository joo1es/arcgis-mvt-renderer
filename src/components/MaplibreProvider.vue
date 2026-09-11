<script lang="ts" setup>
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'
import { provideMaplibreContext, useArcGISView } from '../composables/useMvtContext'
import type { MaplibreProviderProps } from '../types'

const props = withDefaults(
  defineProps<
    MaplibreProviderProps & {
      /**
       * 可选：直接传入 ArcGIS MapView 实例；若不传则自动从父级上下文 (inject('view')) 获取
       */
      view?: any
    }
  >(),
  {}
)

// 获取 ArcGIS MapView 实例
const view = useArcGISView(props.view)

const mapRef = ref<HTMLDivElement>()
const loaded = ref(false)
const map = shallowRef<maplibregl.Map | null>(null)

// 注入 MapLibre 上下文，供子组件 MvtRenderer 获取
provideMaplibreContext(map)

let watchHandle: __esri.WatchHandle | null = null

/**
 * MapLibre WebMercator Zoom=0 Resolution (meters / pixel)
 */
const MAPLIBRE_BASE_RES = 78271.51696402048

/**
 * ArcGIS resolution 转换为 MapLibre zoom
 */
const resolutionToZoom = (resolution: number) => {
  const z = Math.log2(MAPLIBRE_BASE_RES / resolution)
  // MapLibre 支持的合法 zoom 范围限制为 [0, 24]
  return Math.max(0, Math.min(24, z))
}

/**
 * 经度连续性处理：保持 target 与 current 在同一周期，避免跨越 ±180° 日界线拖拽时跳变
 */
const normalizeLongitude = (targetLon: number, currentLon: number) => {
  let lon = targetLon
  while (lon - currentLon > 180) lon -= 360
  while (lon - currentLon < -180) lon += 360
  return lon
}

/**
 * 将 ArcGIS View 的当前视角同步到 MapLibre 实例
 */
const syncMap = () => {
  if (!map.value || !view?.ready) return
  if (!view.center || !view.resolution) return

  // 3D SceneView 保护 (SceneView 由 ArcGIS 原生 VectorTileLayer 处理)
  if (view.type === '3d') {
    return
  }

  let targetLon = 0
  let targetLat = 0

  if (view.spatialReference?.isWebMercator && typeof view.center.x === 'number') {
    // Web Mercator (3857) 模式下直接由 x 线性计算连续经度，即使横向拖拽跨越多个世界也不会被强制截断折返
    targetLon = (view.center.x / 20037508.342789244) * 180
  } else if (typeof view.center.longitude === 'number') {
    const currentLon = map.value.getCenter().lng
    targetLon = normalizeLongitude(view.center.longitude, currentLon)
  }

  if (typeof view.center.latitude === 'number') {
    // Web Mercator 纬度数学有效投影范围截断 [-85.0511, 85.0511]
    targetLat = Math.max(-85.0511, Math.min(85.0511, view.center.latitude))
  }

  map.value.jumpTo({
    center: [targetLon, targetLat],
    zoom: resolutionToZoom(view.resolution),
    bearing: -(view.rotation ?? 0),
  })
}

onMounted(async () => {
  if (!mapRef.value || !view) return

  // 等待 ArcGIS View ready
  if (typeof view.when === 'function') {
    await view.when()
  }

  // 检测坐标系：MapLibre GL 属于 Web 墨卡托投影体系
  if (
    view.spatialReference &&
    !view.spatialReference.isWebMercator &&
    view.spatialReference.wkid !== 3857 &&
    view.spatialReference.wkid !== 102100
  ) {
    console.warn(
      `[MaplibreProvider] 检测到当前 ArcGIS 视图坐标系为 WKID:${view.spatialReference.wkid}（非 Web 墨卡托 EPSG:3857）。\n` +
      `MapLibre GL 核心渲染管线严格基于 Web 墨卡托体系构建，在等经纬度投影（如 CGCS2000 WKID:4490 / WGS84 WKID:4326）或局部投影下会产生纬度拉伸错位。\n` +
      `👉 建议：非 3857 坐标系请直接使用 <MvtRenderer>（不包裹 MaplibreProvider），ArcGIS 原生模式完全支持任意自定义投影方案。`
    )
  }

  // 初始化 MapLibre GL 实例
  map.value = new maplibregl.Map({
    container: mapRef.value,
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
    ...props.options,
  })

  map.value.once('load', () => {
    // 首次视角同步
    syncMap()

    // 监听 ArcGIS View 视角变动，实时同步给 MapLibre
    watchHandle = reactiveUtils.watch(
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

    loaded.value = true
  })
})

// 监听容器尺寸调整，触发 MapLibre resize
const { width, height } = useElementSize(mapRef)
watch([width, height], () => {
  if (map.value) {
    map.value.resize()
  }
})

onUnmounted(() => {
  watchHandle?.remove()
  if (map.value) {
    map.value.remove()
    map.value = null
  }
})

defineExpose({
  map,
  syncMap,
})
</script>

<template>
  <div class="maplibre-provider-view">
    <div ref="mapRef" class="maplibre-provider-content" />
    <slot v-if="loaded" :map="map" />
  </div>
</template>

<style scoped>
.maplibre-provider-view {
  position: absolute;
  inset: 0;
  pointer-events: none;
  width: 100%;
  height: 100%;
}

.maplibre-provider-content {
  width: 100%;
  height: 100%;
}
</style>
