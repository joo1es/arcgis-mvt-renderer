import type { App, Plugin } from 'vue'
import MaplibreProvider from './components/MaplibreProvider.vue'
import MvtRenderer from './components/MvtRenderer.vue'

export { MaplibreProvider, MvtRenderer }
export { provideMaplibreContext, useMaplibreContext } from './composables/useMvtContext'
export { acquireSharedMaplibre } from './composables/useSharedMaplibre'
export * from './types'

const plugin: Plugin = {
  install(app: App) {
    app.component('MaplibreProvider', MaplibreProvider)
    app.component('MvtRenderer', MvtRenderer)
  },
}

export default plugin
