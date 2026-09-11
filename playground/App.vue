<script lang="ts" setup>
import { ref, shallowRef, computed, onMounted, watch } from 'vue'
import Map from '@arcgis/core/Map'
import MapView from '@arcgis/core/views/MapView'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import Graphic from '@arcgis/core/Graphic'
import Point from '@arcgis/core/geometry/Point'
import Polyline from '@arcgis/core/geometry/Polyline'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol'
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol'
import TextSymbol from '@arcgis/core/symbols/TextSymbol'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'
import '@arcgis/core/assets/esri/themes/light/main.css'

import { MaplibreProvider, MvtRenderer } from '../src'
import { PRESETS } from './sampleStyle'

// 国际化语言状态
const lang = ref<'zh' | 'en'>('zh')

// 多语言字典
const i18n = {
  zh: {
    title: 'arcgis-mvt-renderer',
    subtitle: 'Z-Index 与多引擎交互式演练场',
    github: 'GitHub ⭐️',
    engineTitle: '渲染引擎模式',
    maplibreMode: '🟢 MapLibre 模式',
    arcgisMode: '🔵 ArcGIS 原生模式',
    coreTag: '🎯 核心',
    zIndexTitle: 'Z-Index 层级匹配演示',
    topLayer: '顶层：ArcGIS 标绘与注记',
    middleLayer: '中层：MvtRenderer 矢量面切片',
    bottomLayer: '底层：ArcGIS 天地图/矢量底图',
    sandwichBtn: '🥪 夹心层 (在底图上、标绘下)',
    overlapBtn: '🛑 覆盖测试 (MVT 升至最顶)',
    sandwichToggle: '启用三层夹心层穿透 (Sandwich)',
    sandwichOnTip: '✅ 开启三层夹心：通过透明 View 穿透，红色的顶层城市标绘清晰浮在 MapLibre MVT 多边形之上！',
    sandwichOffTip: '❌ 关闭夹心：MapLibre DOM 覆盖在最上方，底层的 ArcGIS 标绘被面数据完全遮挡！',
    showGraphics: '显示高亮标绘图钉与注记',
    presetTitle: '样例切片源',
    customUrlTitle: '自定义瓦片 URL (可选覆盖)',
    customUrlPlaceholder: '例如: https://.../{z}/{x}/{y}.pbf',
    fillColor: '填充颜色',
    opacity: '透明度',
    basemapTitle: '底图风格',
    grayBasemap: '浅灰矢量',
    satelliteBasemap: '高清影像',
    streetsBasemap: '标准街道',
    centerLabel: '中心坐标',
    zoomLabel: '当前层级',
  },
  en: {
    title: 'arcgis-mvt-renderer',
    subtitle: 'Z-Index & Multi-Engine Playground',
    github: 'GitHub ⭐️',
    engineTitle: 'Rendering Engine',
    maplibreMode: '🟢 MapLibre Mode',
    arcgisMode: '🔵 ArcGIS Native Mode',
    coreTag: '🎯 Core',
    zIndexTitle: 'Z-Index Layer Stacking Demo',
    topLayer: 'Top: ArcGIS Graphics & Pins',
    middleLayer: 'Middle: MvtRenderer Vector Tiles',
    bottomLayer: 'Bottom: ArcGIS Basemap',
    sandwichBtn: '🥪 Sandwich (Above Base, Below Pins)',
    overlapBtn: '🛑 Overlap (MVT on Top of Pins)',
    sandwichToggle: 'Enable 3-Layer Sandwich Stacking',
    sandwichOnTip: '✅ Sandwich Enabled: Red markers & labels float cleanly on top of MapLibre polygon fills via transparent view overlay!',
    sandwichOffTip: '❌ Sandwich Disabled: MapLibre DOM sits on top, completely obscuring all underlying ArcGIS graphics!',
    showGraphics: 'Show Highlight Pins & Route',
    presetTitle: 'Sample Vector Tile Presets',
    customUrlTitle: 'Custom Tile URL (Optional Override)',
    customUrlPlaceholder: 'e.g. https://.../{z}/{x}/{y}.pbf',
    fillColor: 'Fill Color',
    opacity: 'Opacity',
    basemapTitle: 'Basemap Style',
    grayBasemap: 'Light Gray',
    satelliteBasemap: 'Satellite',
    streetsBasemap: 'Streets',
    centerLabel: 'Center',
    zoomLabel: 'Zoom',
  },
}

const t = computed(() => i18n[lang.value])

// 地图 DOM 节点与实例
const mainMapRef = ref<HTMLDivElement>()
const topMapRef = ref<HTMLDivElement>()
const mainView = shallowRef<MapView | null>(null)
const topView = shallowRef<MapView | null>(null)

// 标绘图层
const graphicsLayer = shallowRef<GraphicsLayer | null>(null)

// 状态管理
const activePresetIndex = ref(0)
const currentMode = ref<'maplibre' | 'arcgis'>('maplibre')
const customTileUrl = ref('')
const fillColor = ref('#409EFF')
const fillOpacity = ref(0.7)
const selectedBasemap = ref<'gray-vector' | 'satellite' | 'streets-vector'>('gray-vector')

// Z-Index / 层级控制核心状态
const mvtLayerPosition = ref<'middle' | 'top'>('middle') // middle: 夹在底图和标绘之间; top: 置于标绘之上
const showTopGraphics = ref(true)
const maplibreSandwichEnabled = ref(true) // MapLibre 模式下是否启用三层夹心饼干架构

// 当前视口监控
const centerInfo = ref('105.0000, 35.0000')
const zoomInfo = ref('3.00')

const activePreset = computed(() => PRESETS[activePresetIndex.value])

// 响应式组装当前测试的矢量瓦片样式
const activeStyle = computed(() => {
  const base = JSON.parse(JSON.stringify(activePreset.value.style))
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

// 计算 ArcGIS 原生模式下的 layer index
const calculatedArcgisIndex = computed(() => {
  return mvtLayerPosition.value === 'middle' ? 1 : 3
})

// 创建演示标绘数据 (红高亮城市图钉与金色连接虚线)
const buildDemoGraphics = () => {
  const cities = [
    { name: '北京 (Beijing)', coords: [116.4074, 39.9042] },
    { name: '上海 (Shanghai)', coords: [121.4737, 31.2304] },
    { name: '武汉 (Wuhan)', coords: [114.3055, 30.5928] },
    { name: '广州 (Guangzhou)', coords: [113.2644, 23.1291] },
    { name: '成都 (Chengdu)', coords: [104.0665, 30.5723] },
    { name: '东京 (Tokyo)', coords: [139.6917, 35.6895] },
    { name: '伦敦 (London)', coords: [-0.1278, 51.5074] },
  ]

  const graphics: Graphic[] = []

  // 1. 金色连接航线
  graphics.push(
    new Graphic({
      geometry: new Polyline({
        paths: [
          [
            [116.4074, 39.9042],
            [121.4737, 31.2304],
            [114.3055, 30.5928],
            [104.0665, 30.5723],
            [113.2644, 23.1291],
          ],
        ],
      }),
      symbol: new SimpleLineSymbol({
        color: '#F59E0B',
        width: 3,
        style: 'dash',
      }),
    })
  )

  // 2. 城市高亮标绘与文本注记
  cities.forEach((c) => {
    graphics.push(
      new Graphic({
        geometry: new Point({ longitude: c.coords[0], latitude: c.coords[1] }),
        symbol: new SimpleMarkerSymbol({
          color: '#EF4444',
          size: 14,
          outline: { color: '#FFFFFF', width: 2.5 },
        }),
      })
    )

    graphics.push(
      new Graphic({
        geometry: new Point({ longitude: c.coords[0], latitude: c.coords[1] }),
        symbol: new TextSymbol({
          text: c.name,
          color: '#FFFFFF',
          haloColor: '#1F2937',
          haloSize: 2,
          yoffset: 16,
          font: { size: 12, weight: 'bold' },
        }),
      })
    )
  })

  return graphics
}

onMounted(async () => {
  if (!mainMapRef.value || !topMapRef.value) return

  // 1. 创建底层主地图 (包含底图)
  const mainMap = new Map({
    basemap: selectedBasemap.value,
  })

  const view = new MapView({
    container: mainMapRef.value,
    map: mainMap,
    center: activePreset.value.center,
    zoom: activePreset.value.zoom,
    constraints: {
      snapToZoom: false,
    },
  })

  // 必须等待主地图就绪，获取真实的 spatialReference 和初始 viewpoint
  await view.when()
  mainView.value = view

  // 关键：全面使用 reactiveUtils.watch 代替已弃用的 view.watch()，避免 4.32+ 废弃警告
  reactiveUtils.watch(
    () => [view.center?.longitude, view.center?.latitude, view.zoom],
    ([lon, lat, z]) => {
      if (typeof lon === 'number' && typeof lat === 'number') {
        centerInfo.value = `${lon.toFixed(4)}, ${lat.toFixed(4)}`
      }
      if (typeof z === 'number') {
        zoomInfo.value = z.toFixed(2)
      }
    },
    { initial: true }
  )

  // 2. 创建标绘图层
  const gLayer = new GraphicsLayer({
    graphics: buildDemoGraphics(),
  })
  graphicsLayer.value = gLayer

  // 3. 创建顶层透明 MapView (必须完全继承主地图的 spatialReference 与初始 viewpoint)
  const topMap = new Map()
  const tView = new MapView({
    container: topMapRef.value,
    map: topMap,
    spatialReference: view.spatialReference,
    viewpoint: view.viewpoint ? view.viewpoint.clone() : undefined,
    alphaCompositingEnabled: true,
    ui: { components: [] },
    constraints: {
      snapToZoom: false,
    },
  })

  if (tView.container) {
    tView.container.style.pointerEvents = 'none'
  }

  await tView.when()
  topView.value = tView

  // 确保初始 viewpoint 绝对对齐
  if (view.viewpoint) {
    tView.viewpoint = view.viewpoint.clone()
  }

  // 视角强同步：通过 viewpoint 整体克隆同步，保证平移、缩放、旋转完全一致
  reactiveUtils.watch(
    () => view.viewpoint,
    (vp) => {
      if (tView.ready && vp) {
        tView.viewpoint = vp.clone()
      }
    },
    { initial: true, sync: true }
  )

  updateLayerPlacement()
})

// 更新标绘图层应该放置在哪个 MapView
const updateLayerPlacement = () => {
  const gLayer = graphicsLayer.value
  const mView = mainView.value
  const tView = topView.value
  if (!gLayer || !mView?.map || !tView?.map) return

  mView.map.remove(gLayer)
  tView.map.remove(gLayer)

  if (!showTopGraphics.value) return

  if (currentMode.value === 'arcgis') {
    mView.map.add(gLayer, 2)
  } else {
    if (maplibreSandwichEnabled.value && mvtLayerPosition.value === 'middle') {
      tView.map.add(gLayer)
    } else {
      mView.map.add(gLayer)
    }
  }
}

watch([currentMode, mvtLayerPosition, showTopGraphics, maplibreSandwichEnabled], () => {
  updateLayerPlacement()
})

const handleSelectPreset = (idx: number) => {
  activePresetIndex.value = idx
  const preset = PRESETS[idx]
  customTileUrl.value = preset.tileUrl || ''
  if (mainView.value) {
    mainView.value.goTo({
      center: preset.center,
      zoom: preset.zoom,
    })
  }
}

const handleChangeBasemap = (bm: 'gray-vector' | 'satellite' | 'streets-vector') => {
  selectedBasemap.value = bm
  if (mainView.value?.map) {
    mainView.value.map.basemap = bm as any
  }
}
</script>

<template>
  <div class="playground-container">
    <!-- ================= 三层三维视口容器 ================= -->
    <div ref="mainMapRef" class="map-view-surface z-bottom" />

    <MaplibreProvider
      v-if="currentMode === 'maplibre' && mainView"
      :view="mainView"
      class="z-middle"
    >
      <MvtRenderer
        :style="activeStyle"
        :tile-url="customTileUrl || undefined"
      />
    </MaplibreProvider>

    <MvtRenderer
      v-else-if="currentMode === 'arcgis' && mainView"
      :view="mainView"
      :style="activeStyle"
      :tile-url="customTileUrl || undefined"
      :index="calculatedArcgisIndex"
    />

    <div
      ref="topMapRef"
      class="map-view-surface z-top"
      :style="{
        visibility: currentMode === 'maplibre' && maplibreSandwichEnabled && mvtLayerPosition === 'middle' ? 'visible' : 'hidden'
      }"
    />

    <!-- ================= 控制悬浮面板 ================= -->
    <div class="control-panel">
      <!-- 头部：语言切换与项目信息 -->
      <div class="panel-header">
        <div class="title-wrap">
          <span class="logo-emoji">🗺️</span>
          <div>
            <h3>{{ t.title }}</h3>
            <p class="subtitle">{{ t.subtitle }}</p>
          </div>
        </div>
        <div class="header-right">
          <!-- 语言切换药丸按钮 -->
          <div class="lang-switch">
            <button
              :class="['btn-lang', { active: lang === 'zh' }]"
              @click="lang = 'zh'"
            >
              中
            </button>
            <button
              :class="['btn-lang', { active: lang === 'en' }]"
              @click="lang = 'en'"
            >
              EN
            </button>
          </div>
          <a
            href="https://github.com/joo1es/arcgis-mvt-renderer"
            target="_blank"
            class="github-badge"
            rel="noreferrer"
          >
            {{ t.github }}
          </a>
        </div>
      </div>

      <div class="panel-body">
        <!-- 1. 渲染模式切换 -->
        <div class="form-group">
          <label class="form-label">{{ t.engineTitle }}</label>
          <div class="mode-switch">
            <button
              :class="['btn-mode', { active: currentMode === 'maplibre' }]"
              @click="currentMode = 'maplibre'"
            >
              {{ t.maplibreMode }}
            </button>
            <button
              :class="['btn-mode', { active: currentMode === 'arcgis' }]"
              @click="currentMode = 'arcgis'"
            >
              {{ t.arcgisMode }}
            </button>
          </div>
        </div>

        <!-- 2. Z-Index 层级层序控制 (核心演示) -->
        <div class="form-group z-index-section">
          <div class="section-title-wrap">
            <span class="section-badge">{{ t.coreTag }}</span>
            <label class="form-label highlight-title">{{ t.zIndexTitle }}</label>
          </div>

          <!-- 层级可视化指示条 -->
          <div class="stack-visualizer">
            <div
              :class="[
                'stack-item stack-top',
                { 'covered-blur': mvtLayerPosition === 'top' || (currentMode === 'maplibre' && !maplibreSandwichEnabled) }
              ]"
            >
              <div class="item-left">
                <span class="dot red-dot"></span>
                <strong>{{ t.topLayer }}</strong>
              </div>
              <span class="badge-index">Index 2</span>
            </div>

            <div class="stack-item stack-middle active-layer">
              <div class="item-left">
                <span class="dot blue-dot"></span>
                <strong>{{ t.middleLayer }}</strong>
              </div>
              <span class="badge-index">
                {{ currentMode === 'arcgis' ? `Index ${calculatedArcgisIndex}` : 'Sandwich' }}
              </span>
            </div>

            <div class="stack-item stack-bottom">
              <div class="item-left">
                <span class="dot gray-dot"></span>
                <strong>{{ t.bottomLayer }}</strong>
              </div>
              <span class="badge-index">Index 0</span>
            </div>
          </div>

          <!-- 层级相对位置调整 -->
          <div class="z-switch-controls">
            <button
              :class="['btn-z', { active: mvtLayerPosition === 'middle' }]"
              @click="mvtLayerPosition = 'middle'"
            >
              {{ t.sandwichBtn }}
            </button>
            <button
              :class="['btn-z', { active: mvtLayerPosition === 'top' }]"
              @click="mvtLayerPosition = 'top'"
            >
              {{ t.overlapBtn }}
            </button>
          </div>

          <!-- MapLibre 模式特有：三层夹心饼干架构开关 -->
          <div v-if="currentMode === 'maplibre'" class="sandwich-toggle-box">
            <div class="toggle-row">
              <span class="toggle-label">{{ t.sandwichToggle }}</span>
              <input
                v-model="maplibreSandwichEnabled"
                type="checkbox"
                class="checkbox-toggle"
              />
            </div>
            <p class="toggle-tip">
              {{ maplibreSandwichEnabled ? t.sandwichOnTip : t.sandwichOffTip }}
            </p>
          </div>

          <!-- 标绘显隐开关 -->
          <div class="toggle-row mini-toggle">
            <span class="toggle-label">{{ t.showGraphics }}</span>
            <input
              v-model="showTopGraphics"
              type="checkbox"
              class="checkbox-toggle"
            />
          </div>
        </div>

        <!-- 3. 切片源预设 -->
        <div class="form-group">
          <label class="form-label">{{ t.presetTitle }}</label>
          <div class="preset-list">
            <button
              v-for="(p, idx) in PRESETS"
              :key="p.name"
              :class="['btn-preset', { active: activePresetIndex === idx }]"
              @click="handleSelectPreset(idx)"
            >
              {{ lang === 'zh' ? p.name : p.name_en }}
            </button>
          </div>
        </div>

        <!-- 4. 自定义切片 URL 覆盖 -->
        <div class="form-group">
          <label class="form-label">{{ t.customUrlTitle }}</label>
          <input
            v-model="customTileUrl"
            type="text"
            class="input-text"
            :placeholder="t.customUrlPlaceholder"
          />
        </div>

        <!-- 5. 颜色与透明度调节 -->
        <div class="form-group row-group">
          <div class="color-item">
            <label class="form-label">{{ t.fillColor }}</label>
            <input v-model="fillColor" type="color" class="input-color" />
          </div>
          <div class="slider-item">
            <label class="form-label">{{ t.opacity }}: {{ Math.round(fillOpacity * 100) }}%</label>
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

        <!-- 6. 底图切换 -->
        <div class="form-group">
          <label class="form-label">{{ t.basemapTitle }}</label>
          <div class="preset-list">
            <button
              :class="['btn-preset', { active: selectedBasemap === 'gray-vector' }]"
              @click="handleChangeBasemap('gray-vector')"
            >
              {{ t.grayBasemap }}
            </button>
            <button
              :class="['btn-preset', { active: selectedBasemap === 'satellite' }]"
              @click="handleChangeBasemap('satellite')"
            >
              {{ t.satelliteBasemap }}
            </button>
            <button
              :class="['btn-preset', { active: selectedBasemap === 'streets-vector' }]"
              @click="handleChangeBasemap('streets-vector')"
            >
              {{ t.streetsBasemap }}
            </button>
          </div>
        </div>

        <!-- 7. 视口信息 -->
        <div class="status-box">
          <div class="status-row">
            <span>{{ t.centerLabel }}:</span>
            <strong>{{ centerInfo }}</strong>
          </div>
          <div class="status-row">
            <span>{{ t.zoomLabel }}:</span>
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
html,
body {
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

/* 视口绝对定位层级 */
.map-view-surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.z-bottom {
  z-index: 1;
}

.z-middle {
  z-index: 5;
}

.z-top {
  z-index: 10;
  pointer-events: none;
}

/* 浮动控制卡片 */
.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 400px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(14px);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.7);
  z-index: 100;
  padding: 18px 20px;
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

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 语言切换药丸按钮 */
.lang-switch {
  display: flex;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 2px;
}

.btn-lang {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 10.5px;
  font-weight: 700;
  color: #64748b;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-lang.active {
  background: #3b82f6;
  color: #ffffff;
}

.github-badge {
  font-size: 11.5px;
  padding: 4px 8px;
  background: #24292f;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
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

/* ================= Z-Index 专属卡片样式 ================= */
.z-index-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  gap: 10px;
}

.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-badge {
  background: #3b82f6;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.highlight-title {
  color: #1e293b;
  font-weight: 700;
  font-size: 13px;
}

.stack-visualizer {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stack-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 11px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  transition: all 0.2s;
}

.stack-item.covered-blur {
  opacity: 0.45;
  background: #f1f5f9;
  text-decoration: line-through;
}

.stack-item.active-layer {
  border-color: #3b82f6;
  background: #eff6ff;
}

.item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.red-dot {
  background: #ef4444;
  box-shadow: 0 0 6px #ef4444;
}

.blue-dot {
  background: #3b82f6;
}

.gray-dot {
  background: #94a3b8;
}

.badge-index {
  font-size: 10px;
  background: #e2e8f0;
  color: #475569;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.z-switch-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.btn-z {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 11px;
  font-weight: 600;
  padding: 7px 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-z.active {
  background: #1e293b;
  color: #ffffff;
  border-color: #1e293b;
}

.sandwich-toggle-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mini-toggle {
  padding: 2px 4px;
}

.toggle-label {
  font-size: 11px;
  font-weight: 600;
  color: #334155;
}

.checkbox-toggle {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.toggle-tip {
  font-size: 10.5px;
  line-height: 1.4;
  color: #059669;
  margin-top: 2px;
}

/* ================= 其它通用控制项 ================= */
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
