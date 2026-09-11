<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script lang="ts" setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import VectorTileLayer from '@arcgis/core/layers/VectorTileLayer'
import { useMaplibreContext, useArcGISView } from '../composables/useMvtContext'
import type { MvtRendererProps } from '../types'

const props = withDefaults(defineProps<MvtRendererProps>(), {
  visible: true,
})

// 检查是否处于 MapLibreProvider 上下文
const mapContext = useMaplibreContext()
const isMapLibreMode = computed(() => !!mapContext?.value)

// 计算有效的切片 URL 覆盖（兼容 tileUrl 或包含 {z} 的 url 属性）
const effectiveTileUrl = computed(() => {
  if (props.tileUrl) return props.tileUrl
  if (props.url && (props.url.includes('{z}') || props.url.includes('{x}') || props.url.includes('{y}'))) {
    return props.url
  }
  return undefined
})

// 计算有效的样式来源（兼容 style 或作为样式 URL 传入的 url）
const effectiveStyleInput = computed(() => {
  if (props.style) return props.style
  if (props.url && !effectiveTileUrl.value) {
    return props.url
  }
  return null
})

// 缓存解析后的样式对象（当 style 为远程 URL 时异步 fetch）
const fetchedStyle = ref<Record<string, any> | null>(null)

// 监听 style / url 入参，进行解析
watch(
  effectiveStyleInput,
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

  const tileSource = effectiveTileUrl.value
  if (tileSource && cloned.sources) {
    Object.keys(cloned.sources).forEach((key) => {
      if (cloned.sources[key]?.type === 'vector') {
        cloned.sources[key].tiles = [tileSource]
      }
    })
  }

  return cloned
})

// ArcGIS 模式下的样式入参：
// 若无需替换 tileUrl 且入参是 URL 字符串，可直接传递 URL 让 ArcGIS 原生加载
const arcgisStyle = computed(() => {
  if (effectiveTileUrl.value) {
    return resolvedStyleObject.value
  }
  const input = effectiveStyleInput.value
  if (typeof input === 'string' && !input.trim().startsWith('{')) {
    return input
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
      const isVisible = props.visible !== false
      styleObj.layers.forEach((layer: any) => {
        const newLayer = JSON.parse(JSON.stringify(layer))
        if (newLayer.source && sourceIdMap[newLayer.source]) {
          newLayer.source = sourceIdMap[newLayer.source]
        }
        newLayer.id = `${prefix}-${newLayer.id}`

        // 初始显隐控制 (对齐 ArcGIS visible)
        if (!newLayer.layout) newLayer.layout = {}
        newLayer.layout['visibility'] = isVisible ? 'visible' : 'none'

        // 初始透明度注入 (对齐 ArcGIS opacity)
        if (typeof props.opacity === 'number') {
          if (!newLayer.paint) newLayer.paint = {}
          if (newLayer.type === 'fill') newLayer.paint['fill-opacity'] = props.opacity
          else if (newLayer.type === 'line') newLayer.paint['line-opacity'] = props.opacity
          else if (newLayer.type === 'circle') newLayer.paint['circle-opacity'] = props.opacity
        }

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
  if (!arcgisView) return
  if (!arcgisStyle.value && !props.url) return

  if (typeof arcgisView.when === 'function') {
    await arcgisView.when()
  }
  if (!arcgisView.map) return

  // 组装与 ArcGIS VectorTileLayer 构造参数完全一致的配置对象
  const layerOptions: Record<string, any> = {}

  if (arcgisStyle.value) {
    layerOptions.style = arcgisStyle.value as any
  }
  if (props.url && !arcgisStyle.value) {
    layerOptions.url = props.url
  }
  if (typeof props.opacity === 'number') {
    layerOptions.opacity = props.opacity
  }
  if (typeof props.visible === 'boolean') {
    layerOptions.visible = props.visible
  }
  if (typeof props.minScale === 'number') {
    layerOptions.minScale = props.minScale
  }
  if (typeof props.maxScale === 'number') {
    layerOptions.maxScale = props.maxScale
  }
  if (props.title) {
    layerOptions.title = props.title
  }
  if (props.id) {
    layerOptions.id = props.id
  }
  if (props.customParameters) {
    layerOptions.customParameters = props.customParameters
  }
  if (props.blendMode) {
    layerOptions.blendMode = props.blendMode
  }
  if (props.effect) {
    layerOptions.effect = props.effect
  }
  if (props.listMode) {
    layerOptions.listMode = props.listMode
  }
  if (typeof props.legendEnabled === 'boolean') {
    layerOptions.legendEnabled = props.legendEnabled
  }

  arcgisLayer = new VectorTileLayer(layerOptions)

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
      if (styleObj || arcgisStyle.value || props.url) {
        if (isModeChanged) syncArcgisLayer()
        else triggerArcgisSync()
      } else {
        removeArcgisLayer()
      }
    }
  },
  { immediate: true }
)

// 响应 opacity 变动（即时更新 GPU 渲染，零瓦片重载）
watch(
  () => props.opacity,
  (newOpacity) => {
    if (typeof newOpacity !== 'number') return

    if (!isMapLibreMode.value && arcgisLayer) {
      arcgisLayer.opacity = newOpacity
    } else if (isMapLibreMode.value && mapContext?.value) {
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

// 响应 visible 变动 (对齐 ArcGIS visible 属性)
watch(
  () => props.visible,
  (newVisible) => {
    const isVisible = newVisible !== false
    if (!isMapLibreMode.value && arcgisLayer) {
      arcgisLayer.visible = isVisible
    } else if (isMapLibreMode.value && mapContext?.value) {
      const mapInstance = mapContext.value
      addedLayerIds.forEach((layerId) => {
        if (mapInstance.getLayer(layerId)) {
          mapInstance.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none')
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

// 响应 title 变动
watch(
  () => props.title,
  (newTitle) => {
    if (!isMapLibreMode.value && arcgisLayer && newTitle) {
      arcgisLayer.title = newTitle
    }
  }
)

// 响应 minScale / maxScale 变动
watch(
  [() => props.minScale, () => props.maxScale],
  ([minS, maxS]) => {
    if (!isMapLibreMode.value && arcgisLayer) {
      if (typeof minS === 'number') arcgisLayer.minScale = minS
      if (typeof maxS === 'number') arcgisLayer.maxScale = maxS
    }
  }
)

// 响应 blendMode 变动
watch(
  () => props.blendMode,
  (newBlend) => {
    if (!isMapLibreMode.value && arcgisLayer && newBlend) {
      arcgisLayer.blendMode = newBlend as any
    }
  }
)

// 响应 effect 变动
watch(
  () => props.effect,
  (newEffect) => {
    if (!isMapLibreMode.value && arcgisLayer && newEffect) {
      arcgisLayer.effect = newEffect as any
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
