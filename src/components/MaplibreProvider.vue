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
  return Math.log2(MAPLIBRE_BASE_RES / resolution)
}

/**
 * 将 ArcGIS View 的当前视角同步到 MapLibre 实例
 */
const syncMap = () => {
  if (!map.value || !view?.ready) return
  if (!view.center || !view.resolution) return

  map.value.jumpTo({
    center: [view.center.longitude || 0, view.center.latitude || 0],
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
        view.center?.longitude,
        view.center?.latitude,
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
