import { inject, provide, isRef } from 'vue'
import { MAPLIBRE_VIEW_KEY, type MaplibreContext } from '../types'

/**
 * 在父级组件中注入 MapLibre 实例上下文
 */
export function provideMaplibreContext(mapContext: MaplibreContext) {
  provide(MAPLIBRE_VIEW_KEY, mapContext)
  provide('mapview', mapContext)
}

/**
 * 在子组件中提取 MapLibre 实例上下文
 */
export function useMaplibreContext(): MaplibreContext | undefined {
  const symbolInject = inject(MAPLIBRE_VIEW_KEY, undefined)
  if (symbolInject) return symbolInject

  return inject<MaplibreContext | undefined>('mapview', undefined)
}

/**
 * 自动解析并获取当前环境的 ArcGIS MapView 实例
 * 无需依赖 @vuesri/core，兼容原生 @arcgis/core、@vuesri/core 以及常规 Vue provide
 */
export function useArcGISView(propsView?: any): any {
  if (propsView) {
    return isRef(propsView) ? propsView.value : propsView
  }

  // 1. 尝试 inject('view') (主流 ArcGIS Vue 封装如 @vuesri/core 的标准注入名)
  const standardView = inject<any>('view', undefined)
  if (standardView) {
    return isRef(standardView) ? standardView.value : standardView
  }

  // 2. 尝试备用命名
  const arcgisView = inject<any>('arcgisView', undefined)
  if (arcgisView) {
    return isRef(arcgisView) ? arcgisView.value : arcgisView
  }

  return undefined
}
