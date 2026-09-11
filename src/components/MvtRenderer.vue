<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script lang="ts" setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import VectorTileLayer from '@arcgis/core/layers/VectorTileLayer'
import { useMaplibreContext, useArcGISView } from '../composables/useMvtContext'
import type { MvtRendererProps } from '../types'

const props = defineProps<MvtRendererProps>()

// 检查是否处于 MapLibreProvider 上下文
const mapContext = useMaplibreContext()
const isMapLibreMode = computed(() => !!mapContext?.value)

// 缓存解析后的样式对象（当 style 为远程 URL 时异步 fetch）
const fetchedStyle = ref<Record<string, any> | null>(null)

// 监听 style 入参，进行解析
watch(
  () => props.style,
  async (newStyle) => {
    if (!newStyle) {
      fetchedStyle.value = null
      return
    }

    if (typeof newStyle === 'string') {
      const trimmed = newStyle.trim()
      // 判断是否为 JSON 字符串
      if (trimmed.startsWith('{')) {
        try {
          fetchedStyle.value = JSON.parse(trimmed)
        } catch (e) {
          console.error('[MvtRenderer] 解析 JSON style 失败:', e)
          fetchedStyle.value = null
        }
      } else {
        // 判定为远程 style.json URL，发起请求解析
        try {
          const res = await fetch(trimmed)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          fetchedStyle.value = await res.json()
        } catch (e) {
          console.error('[MvtRenderer] 请求远程 style.json 失败:', e)
          fetchedStyle.value = null
        }
      }
    } else if (typeof newStyle === 'object') {
      fetchedStyle.value = newStyle
    }
  },
  { immediate: true, deep: true }
)

// 计算并返回规范化的样式对象（如果配置了 tileUrl 则替换矢量瓦片请求地址）
const resolvedStyleObject = computed<Record<string, any> | null>(() => {
  if (!fetchedStyle.value) return null
  const cloned = JSON.parse(JSON.stringify(fetchedStyle.value))

  if (props.tileUrl && cloned.sources) {
    Object.keys(cloned.sources).forEach((key) => {
      if (cloned.sources[key]?.type === 'vector') {
        cloned.sources[key].tiles = [props.tileUrl]
      }
    })
  }

  return cloned
})

// ArcGIS 模式下的样式入参：
// 若无需替换 tileUrl 且入参是 URL 字符串，可直接传递 URL 让 ArcGIS 原生加载
const arcgisStyle = computed(() => {
  if (props.tileUrl) {
    return resolvedStyleObject.value
  }
  if (typeof props.style === 'string' && !props.style.trim().startsWith('{')) {
    return props.style
  }
  return resolvedStyleObject.value
})

// ------------------- 1. MapLibre 模式：图层与数据源动态生命周期管理 -------------------
let addedSourceIds: string[] = []
let addedLayerIds: string[] = []

const removeMapLibreLayers = () => {
  const mapInstance = mapContext?.value
  if (!mapInstance) return

  // 倒序注销图层
  for (let i = addedLayerIds.length - 1; i >= 0; i--) {
    const layerId = addedLayerIds[i]
    if (mapInstance.getLayer(layerId)) {
      mapInstance.removeLayer(layerId)
    }
  }
  addedLayerIds = []

  // 注销数据源
  addedSourceIds.forEach((sourceId) => {
    if (mapInstance.getSource(sourceId)) {
      mapInstance.removeSource(sourceId)
    }
  })
  addedSourceIds = []
}

const addMapLibreLayers = (styleObj: Record<string, any>) => {
  const mapInstance = mapContext?.value
  if (!mapInstance || !styleObj) return

  const apply = () => {
    removeMapLibreLayers()

    // 生成唯一前缀，避免同屏多个组件实例命名冲突
    const prefix = `mvt-${Math.random().toString(36).slice(2, 7)}-${Date.now()}`
    const sourceIdMap: Record<string, string> = {}

    // 1. 添加 Sources
    if (styleObj.sources && typeof styleObj.sources === 'object') {
      Object.keys(styleObj.sources).forEach((origSourceId) => {
        const uniqueSourceId = `${prefix}-${origSourceId}`
        sourceIdMap[origSourceId] = uniqueSourceId
        mapInstance.addSource(uniqueSourceId, styleObj.sources[origSourceId])
        addedSourceIds.push(uniqueSourceId)
      })
    }

    // 2. 字体 (Glyphs) 配置
    if (styleObj.glyphs && !mapInstance.getStyle()?.glyphs) {
      mapInstance.setGlyphs(styleObj.glyphs)
    }

    // 3. 添加 Layers
    if (Array.isArray(styleObj.layers)) {
      styleObj.layers.forEach((layer: any) => {
        const newLayer = JSON.parse(JSON.stringify(layer))
        if (newLayer.source && sourceIdMap[newLayer.source]) {
          newLayer.source = sourceIdMap[newLayer.source]
        }
        newLayer.id = `${prefix}-${newLayer.id}`

        // 插入图层（支持 beforeId 层级控制）
        const validBeforeId =
          props.beforeId && mapInstance.getLayer(props.beforeId)
            ? props.beforeId
            : undefined

        mapInstance.addLayer(newLayer, validBeforeId)
        addedLayerIds.push(newLayer.id)
      })
    }
  }

  if (mapInstance.isStyleLoaded()) {
    apply()
  } else {
    mapInstance.once('styledata', apply)
  }
}

// ------------------- 2. ArcGIS 原生模式：原生 VectorTileLayer 生命周期管理 -------------------
const arcgisView = useArcGISView(props.view)
let arcgisLayer: VectorTileLayer | null = null

const removeArcgisLayer = () => {
  if (arcgisLayer && arcgisView?.map) {
    arcgisView.map.remove(arcgisLayer)
    arcgisLayer.destroy()
    arcgisLayer = null
  }
}

const syncArcgisLayer = async () => {
  removeArcgisLayer()
  if (!arcgisView || !arcgisStyle.value) return

  if (typeof arcgisView.when === 'function') {
    await arcgisView.when()
  }
  if (!arcgisView.map) return

  arcgisLayer = new VectorTileLayer({
    style: arcgisStyle.value as any,
    opacity: typeof props.opacity === 'number' ? props.opacity : 1,
  })

  if (typeof props.index === 'number') {
    arcgisView.map.add(arcgisLayer, props.index)
  } else {
    arcgisView.map.add(arcgisLayer)
  }
}

let arcgisSyncTimer: any = null
const triggerArcgisSync = () => {
  if (arcgisSyncTimer) clearTimeout(arcgisSyncTimer)
  arcgisSyncTimer = setTimeout(() => {
    syncArcgisLayer()
  }, 100)
}

// ------------------- 响应式生命周期统一调度 -------------------
watch(
  [resolvedStyleObject, isMapLibreMode],
  ([styleObj, isMapLibre], oldVals) => {
    const isModeChanged = !oldVals || oldVals[1] !== isMapLibre
    if (isMapLibre) {
      removeArcgisLayer()
      if (styleObj) addMapLibreLayers(styleObj)
      else removeMapLibreLayers()
    } else {
      removeMapLibreLayers()
      if (styleObj || arcgisStyle.value) {
        if (isModeChanged) syncArcgisLayer()
        else triggerArcgisSync()
      } else {
        removeArcgisLayer()
      }
    }
  },
  { immediate: true }
)

// 响应 opacity 变动（即时更新 GPU 渲染，零瓦片重载，避免拖拽时不断销毁重建闪烁）
watch(
  () => props.opacity,
  (newOpacity) => {
    if (typeof newOpacity !== 'number') return

    if (!isMapLibreMode.value && arcgisLayer) {
      // ArcGIS 模式：直接更新图层透明度属性
      arcgisLayer.opacity = newOpacity
    } else if (isMapLibreMode.value && mapContext?.value) {
      // MapLibre 模式：直接更新已挂载图层的 paint 属性
      const mapInstance = mapContext.value
      addedLayerIds.forEach((layerId) => {
        const lyr = mapInstance.getLayer(layerId)
        if (lyr) {
          if (lyr.type === 'fill') {
            mapInstance.setPaintProperty(layerId, 'fill-opacity', newOpacity)
          } else if (lyr.type === 'line') {
            mapInstance.setPaintProperty(layerId, 'line-opacity', newOpacity)
          } else if (lyr.type === 'circle') {
            mapInstance.setPaintProperty(layerId, 'circle-opacity', newOpacity)
          } else if (lyr.type === 'raster') {
            mapInstance.setPaintProperty(layerId, 'raster-opacity', newOpacity)
          }
        }
      })
    }
  }
)

// 响应 index 变动 (仅 ArcGIS 模式有效)
watch(
  () => props.index,
  (newIndex) => {
    if (!isMapLibreMode.value && arcgisLayer && arcgisView?.map && typeof newIndex === 'number') {
      arcgisView.map.reorder(arcgisLayer, newIndex)
    }
  }
)

onUnmounted(() => {
  if (arcgisSyncTimer) clearTimeout(arcgisSyncTimer)
  removeMapLibreLayers()
  removeArcgisLayer()
})

defineExpose({
  isMapLibreMode,
  resolvedStyleObject,
  arcgisLayer: () => arcgisLayer,
})
</script>

<template>
  <slot />
</template>
