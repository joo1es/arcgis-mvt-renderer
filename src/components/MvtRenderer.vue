<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<script lang="ts" setup>
import { computed, shallowRef, watch, onUnmounted } from 'vue'
import { ArcGISMvtLayer } from '../core/ArcGISMvtLayer'
import { useArcGISView } from '../composables/useMvtContext'
import type { MvtRendererProps } from '../types'

const props = withDefaults(defineProps<MvtRendererProps>(), {
  engine: 'auto',
  visible: true,
})

// 解析当前环境的 ArcGIS View 实例（响应式跟踪 props.view 或 inject('view')）
const arcgisView = computed(() => useArcGISView(props.view))

// 底层纯 JS ArcGISMvtLayer 实例
const layerInstance = shallowRef<ArcGISMvtLayer | null>(null)

// 响应式跟踪当前视图实例的构建与重建
watch(
  () => arcgisView.value,
  (view) => {
    if (layerInstance.value) {
      layerInstance.value.destroy()
      layerInstance.value = null
    }

    if (view) {
      layerInstance.value = new ArcGISMvtLayer({
        ...props,
        view,
      })
    }
  },
  { immediate: true }
)

// 响应式监听 style / url / tileUrl 变化
watch(
  [() => props.style, () => props.url, () => props.tileUrl],
  ([style, url, tileUrl]) => {
    if (layerInstance.value) {
      if (tileUrl) {
        layerInstance.value.setTileUrl(tileUrl)
      } else if (style || url) {
        layerInstance.value.setStyle(style || url || {})
      }
    }
  }
)

// 响应式监听 opacity
watch(
  () => props.opacity,
  (newOpacity) => {
    if (layerInstance.value && typeof newOpacity === 'number') {
      layerInstance.value.setOpacity(newOpacity)
    }
  }
)

// 响应式监听 visible
watch(
  () => props.visible,
  (newVisible) => {
    if (layerInstance.value && typeof newVisible === 'boolean') {
      layerInstance.value.setVisible(newVisible)
    }
  }
)

// 响应式监听 engine 切换
watch(
  () => props.engine,
  (newEngine) => {
    if (layerInstance.value && newEngine) {
      layerInstance.value.setEngine(newEngine)
    }
  }
)

onUnmounted(() => {
  if (layerInstance.value) {
    layerInstance.value.destroy()
    layerInstance.value = null
  }
})

// defineExpose 向上暴露方法与状态引用
defineExpose({
  layer: () => layerInstance.value,
  getMapInstance: () => layerInstance.value?.getMapInstance(),
  getArcgisLayer: () => layerInstance.value?.getArcgisLayer(),
  isMapLibreMode: computed(() => layerInstance.value?.isMapMode ?? true),
  actualEngine: computed(() => layerInstance.value?.actualEngine ?? 'arcgis'),
  resolvedStyleObject: computed(() => layerInstance.value?.getResolvedStyle() ?? null),
})
</script>

<template>
  <slot />
</template>
