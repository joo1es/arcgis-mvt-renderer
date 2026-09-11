<script lang="ts" setup>
import { ref, shallowRef, computed, onMounted } from 'vue'
import Map from '@arcgis/core/Map'
import MapView from '@arcgis/core/views/MapView'
import '@arcgis/core/assets/esri/themes/light/main.css'

import { MaplibreProvider, MvtRenderer } from '../src'
import { PRESETS } from './sampleStyle'

// 地图 DOM 与实例
const mapRef = ref<HTMLDivElement>()
const arcgisView = shallowRef<MapView | null>(null)

// 交互状态
const activePresetIndex = ref(0)
const currentMode = ref<'maplibre' | 'arcgis'>('maplibre')
const customTileUrl = ref('')
const fillColor = ref('#409EFF')
const fillOpacity = ref(0.7)
const selectedBasemap = ref<'gray-vector' | 'satellite' | 'streets-vector'>('gray-vector')

// 当前坐标视口监控
const centerInfo = ref('105.0000, 35.0000')
const zoomInfo = ref('3.00')

const activePreset = computed(() => PRESETS[activePresetIndex.value])

// 响应式组装当前测试的矢量瓦片样式
const activeStyle = computed(() => {
  const base = JSON.parse(JSON.stringify(activePreset.value.style))
  // 注入动态调节的颜色与透明度
  if (Array.isArray(base.layers)) {
    base.layers.forEach((l: any) => {
      if (l.type === 'fill' && l.paint) {
        l.paint['fill-color'] = fillColor.value
        l.paint['fill-opacity'] = fillOpacity.value
      }
    })
  }
  return base
})

onMounted(() => {
  if (!mapRef.value) return

  const map = new Map({
    basemap: selectedBasemap.value,
  })

  const view = new MapView({
    container: mapRef.value,
    map,
    center: activePreset.value.center,
    zoom: activePreset.value.zoom,
    constraints: {
      snapToZoom: false,
    },
  })

  view.watch('center', (c) => {
    if (c) centerInfo.value = `${c.longitude.toFixed(4)}, ${c.latitude.toFixed(4)}`
  })
  view.watch('zoom', (z) => {
    if (typeof z === 'number') zoomInfo.value = z.toFixed(2)
  })

  arcgisView.value = view
})

// 切换预设
const handleSelectPreset = (idx: number) => {
  activePresetIndex.value = idx
  const preset = PRESETS[idx]
  customTileUrl.value = preset.tileUrl || ''
  if (arcgisView.value) {
    arcgisView.value.goTo({
      center: preset.center,
      zoom: preset.zoom,
    })
  }
}

// 切换底图
const handleChangeBasemap = (bm: 'gray-vector' | 'satellite' | 'streets-vector') => {
  selectedBasemap.value = bm
  if (arcgisView.value?.map) {
    arcgisView.value.map.basemap = bm as any
  }
}
</script>

<template>
  <div class="playground-container">
    <!-- 地图容器 -->
    <div ref="mapRef" class="map-view-surface">
      <!-- 模式一：MapLibre Provider 模式 -->
      <MaplibreProvider v-if="currentMode === 'maplibre' && arcgisView" :view="arcgisView">
        <MvtRenderer
          :style="activeStyle"
          :tile-url="customTileUrl || undefined"
        />
      </MaplibreProvider>

      <!-- 模式二：ArcGIS 原生模式 -->
      <MvtRenderer
        v-else-if="currentMode === 'arcgis' && arcgisView"
        :view="arcgisView"
        :style="activeStyle"
        :tile-url="customTileUrl || undefined"
        :index="1"
      />
    </div>

    <!-- 顶部控制悬浮卡片 -->
    <div class="control-panel">
      <div class="panel-header">
        <div class="title-wrap">
          <span class="logo-emoji">🗺️</span>
          <div>
            <h3>arcgis-mvt-renderer</h3>
            <p class="subtitle">Interactive Test Playground & Demo</p>
          </div>
        </div>
        <a
          href="https://github.com/joo1es/arcgis-mvt-renderer"
          target="_blank"
          class="github-badge"
          rel="noreferrer"
        >
          GitHub ⭐️
        </a>
      </div>

      <div class="panel-body">
        <!-- 渲染模式切换 -->
        <div class="form-group">
          <label class="form-label">渲染引擎模式</label>
          <div class="mode-switch">
            <button
              :class="['btn-mode', { active: currentMode === 'maplibre' }]"
              @click="currentMode = 'maplibre'"
            >
              🟢 MapLibre 模式 (推荐)
            </button>
            <button
              :class="['btn-mode', { active: currentMode === 'arcgis' }]"
              @click="currentMode = 'arcgis'"
            >
              🔵 ArcGIS 原生模式
            </button>
          </div>
          <p class="mode-tip">
            <span v-if="currentMode === 'maplibre'">
              ✨ <strong>MapLibre 模式</strong>：视口保持高精同步，支持任意多边形绕向面填充（Fill），解决原生空白问题。
            </span>
            <span v-else>
              ℹ️ <strong>ArcGIS 原生模式</strong>：回退为原生 VectorTileLayer，可直观对比非标多边形是否缺失。
            </span>
          </p>
        </div>

        <!-- 样例预设切换 -->
        <div class="form-group">
          <label class="form-label">样例切片源</label>
          <div class="preset-list">
            <button
              v-for="(p, idx) in PRESETS"
              :key="p.name"
              :class="['btn-preset', { active: activePresetIndex === idx }]"
              @click="handleSelectPreset(idx)"
            >
              {{ p.name }}
            </button>
          </div>
        </div>

        <!-- 自定义切片 URL 注入 -->
        <div class="form-group">
          <label class="form-label">自定义瓦片 URL (可选覆盖)</label>
          <input
            v-model="customTileUrl"
            type="text"
            class="input-text"
            placeholder="例如: https://.../{z}/{x}/{y}.pbf"
          />
        </div>

        <!-- 样式调色板 (验证响应式) -->
        <div class="form-group row-group">
          <div class="color-item">
            <label class="form-label">填充颜色</label>
            <input v-model="fillColor" type="color" class="input-color" />
          </div>
          <div class="slider-item">
            <label class="form-label">透明度: {{ Math.round(fillOpacity * 100) }}%</label>
            <input
              v-model.number="fillOpacity"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              class="input-slider"
            />
          </div>
        </div>

        <!-- 底图切换 -->
        <div class="form-group">
          <label class="form-label">底图风格</label>
          <div class="preset-list">
            <button
              :class="['btn-preset', { active: selectedBasemap === 'gray-vector' }]"
              @click="handleChangeBasemap('gray-vector')"
            >
              浅灰矢量
            </button>
            <button
              :class="['btn-preset', { active: selectedBasemap === 'satellite' }]"
              @click="handleChangeBasemap('satellite')"
            >
              高清影像
            </button>
            <button
              :class="['btn-preset', { active: selectedBasemap === 'streets-vector' }]"
              @click="handleChangeBasemap('streets-vector')"
            >
              标准街道
            </button>
          </div>
        </div>

        <!-- 状态监视器 -->
        <div class="status-box">
          <div class="status-row">
            <span>当前中心:</span>
            <strong>{{ centerInfo }}</strong>
          </div>
          <div class="status-row">
            <span>缩放等级:</span>
            <strong>{{ zoomInfo }}</strong>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
</style>

<style scoped>
.playground-container {
  position: relative;
  width: 100vw;
  height: 100vh;
}

.map-view-surface {
  width: 100%;
  height: 100%;
}

/* 浮动控制卡片 */
.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 380px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.7);
  z-index: 100;
  padding: 16px 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-emoji {
  font-size: 26px;
}

.panel-header h3 {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.subtitle {
  font-size: 11px;
  color: #6b7280;
}

.github-badge {
  font-size: 12px;
  padding: 4px 8px;
  background: #24292f;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
  transition: opacity 0.2s;
}

.github-badge:hover {
  opacity: 0.85;
}

.panel-body {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  background: #f3f4f6;
  padding: 3px;
  border-radius: 8px;
}

.btn-mode {
  border: none;
  padding: 8px 4px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: #6b7280;
  transition: all 0.2s;
}

.btn-mode.active {
  background: #ffffff;
  color: #111827;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.mode-tip {
  font-size: 11px;
  line-height: 1.4;
  color: #4b5563;
  margin-top: 2px;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.btn-preset {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-preset:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.btn-preset.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1d4ed8;
  font-weight: 600;
}

.input-text {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 11px;
  color: #111827;
}

.input-text:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.row-group {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.color-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-color {
  border: none;
  width: 48px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
}

.slider-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-slider {
  width: 100%;
  cursor: pointer;
}

.status-box {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: #4b5563;
}

.status-row {
  display: flex;
  justify-content: space-between;
}
</style>
