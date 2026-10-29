import { createApp } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
// 注册 MapLibre 引擎（主入口已不再静态依赖 maplibre-gl）
import '../src/engines/maplibre'
import App from './App.vue'

const app = createApp(App)
app.mount('#app')
