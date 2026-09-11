/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App, Plugin } from 'vue'
import { ArcGISMvtLayer } from './core/ArcGISMvtLayer'
import MaplibreProvider from './components/MaplibreProvider.vue'
import MvtRenderer from './components/MvtRenderer.vue'

// 1. 核心纯 JS/TS 原生类（零前端框架依赖，可用于 Vanilla TS、React、Vue、Angular 等）
export { ArcGISMvtLayer }

// 2. Vue 3 专属组件与组合式 API
export { MaplibreProvider, MvtRenderer }
export { provideMaplibreContext, useMaplibreContext, useArcGISView } from './composables/useMvtContext'
export { acquireSharedEngine, acquireSharedMaplibre } from './composables/useSharedMaplibre'

// 3. 全部 TypeScript 类型定义
export * from './types'

// 4. Vue 3 插件安装器
export const plugin: Plugin = {
  install(app: App) {
    app.component('MaplibreProvider', MaplibreProvider)
    app.component('MvtRenderer', MvtRenderer)
  },
}

// 默认导出纯 JS/TS 原生类 ArcGISMvtLayer，支持 import ArcGISMvtLayer from 'arcgis-mvt-renderer'
export default ArcGISMvtLayer
