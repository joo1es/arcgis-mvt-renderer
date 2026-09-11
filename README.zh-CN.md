# arcgis-mvt-renderer

<p align="center">
  <b>面向 Vue 3 的 ArcGIS Maps SDK 与 MapLibre GL 双模式无缝兼容 MVT (Mapbox Vector Tile) 矢量切片渲染组件。</b>
</p>

<p align="center">
  <b>简体中文</b> | <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/arcgis-mvt-renderer"><img src="https://img.shields.io/npm/v/arcgis-mvt-renderer.svg" alt="npm version"></a>
  <a href="https://github.com/vuejs/core"><img src="https://img.shields.io/badge/vue-3.x-brightgreen.svg" alt="vue 3"></a>
  <a href="https://developers.arcgis.com/javascript/"><img src="https://img.shields.io/badge/@arcgis/core-4.x-blue.svg" alt="arcgis"></a>
  <a href="https://maplibre.org/"><img src="https://img.shields.io/badge/maplibre--gl-3.x%20--%205.x-teal.svg" alt="maplibre"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/arcgis-mvt-renderer.svg" alt="license"></a>
</p>

---

## 💡 为什么需要 `arcgis-mvt-renderer`？

在 **ArcGIS Maps SDK for JavaScript** 中加载第三方或自建的 MVT (Mapbox Vector Tile) 矢量切片时，经常会遇到一个棘手的问题：**多边形实心填充面（`type: "fill"`）完全无法显示或变透明，而边框轮廓线（`type: "line"`）却能正常渲染**。

### 根本原因剖析
- **MVT 2.1 规范要求**：在瓦片屏幕像素坐标系（Y 轴向下）中，**外环必须是顺时针（CW）**，内环/孔洞必须是**逆时针（CCW）**。
- **ArcGIS 的严格限制 vs. MapLibre 的高容错**：大多数后端数据切片管道（例如 PostGIS 未调用 `ST_ForcePolygonCW` 的 `ST_AsMVT`、GeoServer、自研 Python/Go 切片脚本）默认以大地坐标系（外环逆时针）导出。ArcGIS 的底层 WebGL 三角剖分引擎会严格把逆时针外环判定为“没有外边界的无主洞”，导致生成的三角面片数为 0，实心面彻底消失。
- **解决方案**：MapLibre GL 内部使用鲁棒的 `earcut` 多边形剖分算法，对环绕向容错极高，能够稳定渲染非标绕向的面数据。

`arcgis-mvt-renderer` 将两者的优势结合：
1. **统一传递标准 `:style`**：直接接收原生的 Mapbox Style Spec v8 样式对象或远程 `style.json` 地址，无需自行适配转换。
2. **双模式自适应渲染**：包裹在 `<MaplibreProvider>` 内时自动通过 MapLibre GL 高性能渲染并保持视角与 ArcGIS 实时同步；未包裹时自动降级回退至原生 `@arcgis/core/layers/VectorTileLayer`。
3. **彻底解耦第三方框架**：不绑定任何私有 UI 封装。无论是纯原生 `@arcgis/core`、`@vuesri/core` 还是其它 Vue 3 项目均可无缝集成。

---

## 🌟 核心特性

- 🎯 **传统标准 `:style` 入参**：直接使用标准 Mapbox Style Spec v8 样式对象或远程 `style.json` URL，无需在业务中做转译。
- ⚡ **双模式自适应架构**：
  - **MapLibre 模式**：利用 MapLibre GL 解决实心多边形缺失与性能瓶颈，视角与 ArcGIS 绝对同步。
  - **ArcGIS 原生模式**：独立使用时自动回退为原生的 `VectorTileLayer`。
- 🔄 **高精度视口同步**：实时将 ArcGIS MapView 的经纬度中心、分辨率、缩放级别与旋转角同步至 MapLibre。
- 🛡️ **作用域安全隔离**：为动态添加的 Sources 和 Layers 自动分配前缀与唯一 ID，支持同屏多个组件实例共存而不发生 ID 碰撞。
- 🧩 **零框架强绑定**：自动从属性、`inject('view')` 或 `@vuesri/core` 探查当前 ArcGIS MapView 实例，随插随用。
- 📦 **开箱即用 TypeScript**：内置完整的 `.d.ts` 类型声明文件。

---

## 📦 安装

```bash
# 使用 pnpm
pnpm add arcgis-mvt-renderer

# 使用 npm
npm install arcgis-mvt-renderer

# 使用 yarn
yarn add arcgis-mvt-renderer
```

### Peer Dependencies
请确保宿主项目中安装了基础依赖：

```bash
pnpm add vue maplibre-gl @arcgis/core
```

---

## 🚀 快速上手

### 1. 全局注册插件（可选）

```typescript
// main.ts
import { createApp } from 'vue'
import ArcGISMvtRenderer from 'arcgis-mvt-renderer'
import App from './App.vue'

const app = createApp(App)
app.use(ArcGISMvtRenderer)
app.mount('#app')
```

### 2. 使用示例

#### 模式一：搭配 `MaplibreProvider` 使用（推荐，解决面填充缺失与复杂切片性能问题）

使用 `<MaplibreProvider>` 包裹 `<MvtRenderer>`。Provider 会在地图上层建立同步视口层：

```vue
<template>
  <div ref="mapContainer" class="map-view">
    <!-- MaplibreProvider 会自动将自身的 MapLibre 视角与 arcgisView 保持同步 -->
    <MaplibreProvider :view="arcgisView">
      <MvtRenderer
        :style="vectorTileStyle"
        tile-url="https://your-server.com/v1/mvt/{z}/{x}/{y}.pbf"
      />
    </MaplibreProvider>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MapView from '@arcgis/core/views/MapView'
import Map from '@arcgis/core/Map'
import { MaplibreProvider, MvtRenderer } from 'arcgis-mvt-renderer'

const mapContainer = ref<HTMLDivElement>()
const arcgisView = ref<MapView>()

onMounted(() => {
  arcgisView.value = new MapView({
    container: mapContainer.value,
    map: new Map({ basemap: 'satellite' }),
    center: [114.3, 30.5],
    zoom: 10
  })
})

// 标准 Mapbox Style Spec v8 样式对象（也可以直接传递指向 style.json 的 URL 字符串）
const vectorTileStyle = ref({
  version: 8,
  sources: {
    'my-source': {
      type: 'vector',
      tiles: ['https://your-server.com/v1/mvt/{z}/{x}/{y}.pbf']
    }
  },
  layers: [
    {
      id: 'my-polygon-fill',
      type: 'fill',
      source: 'my-source',
      'source-layer': 'my_layer_name',
      paint: {
        'fill-color': '#409EFF',
        'fill-opacity': 0.7
      }
    },
    {
      id: 'my-polygon-outline',
      type: 'line',
      source: 'my-source',
      'source-layer': 'my_layer_name',
      paint: {
        'line-color': '#1E3A8A',
        'line-width': 1.5
      }
    }
  ]
})
</script>

<style scoped>
.map-view {
  position: relative;
  width: 100vw;
  height: 100vh;
}
</style>
```

#### 模式二：在 `@vuesri/core` 中使用（零配置自动发现）

如果你在项目中使用 `@vuesri/core`，`<MaplibreProvider>` 会自动通过 `inject('view')` 寻找到父级 `MapView`，**无需显式传递 `:view`**：

```vue
<template>
  <VaMapView :default-options="mapOptions">
    <!-- 自动绑定父级 VaMapView 实例 -->
    <MaplibreProvider>
      <MvtRenderer :style="vectorTileStyle" />
    </MaplibreProvider>

    <!-- 底图与其他业务图层 -->
    <VaTdtBasemap :type="'vec_w'" />
  </VaMapView>
</template>

<script setup lang="ts">
import { MaplibreProvider, MvtRenderer } from 'arcgis-mvt-renderer'
// ...
</script>
```

#### 模式三：ArcGIS 原生模式与 3D 数字地球 (`SceneView`)

当在 `<MaplibreProvider>` 外部独立使用，或在 3D 数字地球 (`SceneView`) 中使用时，`<MvtRenderer>` 自动挂载原生 `@arcgis/core/layers/VectorTileLayer`，将矢量瓦片自然贴合在 3D 地球曲面上：

```vue
<template>
  <div ref="sceneContainer" class="map-view">
    <!-- 3D 视角下原生贴地渲染 -->
    <MvtRenderer
      :view="sceneView"
      :style="vectorTileStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SceneView from '@arcgis/core/views/SceneView'
import Map from '@arcgis/core/Map'
import { MvtRenderer } from 'arcgis-mvt-renderer'

const sceneContainer = ref<HTMLDivElement>()
const sceneView = ref<SceneView>()

onMounted(() => {
  sceneView.value = new SceneView({
    container: sceneContainer.value,
    map: new Map({ basemap: 'satellite' }),
    camera: { position: [105, 25, 8000000], tilt: 45 }
  })
})
</script>
```

> **💡 提示（缩放约束建议）**：
> 在 2D `MapView` 中搭配 `MaplibreProvider` 使用时，建议为 MapView 配置 `constraints: { minZoom: 2, maxZoom: 18, snapToZoom: false }`，以防止无限拉远至尺度极端时触发墨卡托切片截断。

---

## 🌐 坐标系与空间参考支持 (Spatial Reference Guide)

| 坐标系体系 | 典型代表 | 推荐模式 | 说明 |
| :--- | :--- | :--- | :--- |
| **Web 墨卡托** | `EPSG:3857` / `WKID:102100` / 天地图墨卡托 (`_w`) | **MapLibre 模式** 或 **ArcGIS 原生模式** | **完全支持**。MapLibre GL 规范原生基于 Web 墨卡托四叉树构建，视口同步及几何形状 100% 严密贴合。 |
| **地理经纬度** | `CGCS2000 (WKID:4490)` / `WGS84 (EPSG:4326)` / 天地图经纬度 (`_c`) | **ArcGIS 原生模式** (`<MvtRenderer>`) | **ArcGIS 原生模式完全支持**。ArcGIS `VectorTileLayer` 原生支持 4490/4326 切片方案。若在 4490 下使用 MapLibre，因其底层缺乏等经纬投影瓦片管道，会发生纬度拉伸形变。 |
| **高斯/局部投影** | 城市 3 度带高斯克吕格投影 / 地方独立坐标系 | **ArcGIS 原生模式** (`<MvtRenderer>`) | **ArcGIS 原生模式完全支持**。只要矢量切片发布了对应投影的 Tiling Scheme，ArcGIS 原生模式即可自动读取并精确渲染。 |

---

## 📖 API 参数详解

### `<MvtRenderer>`（参数完全对齐 ArcGIS VectorTileLayer）

| 属性名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `style` | `string \| Record<string, any>` | `undefined` | 标准 Mapbox/ArcGIS Style Spec v8 样式对象、JSON 字符串，或远程 `style.json` 访问地址。与 `url` 属性二选一。 |
| `url` | `string` | `undefined` | 矢量切片服务地址或样式文件 URL，**完全对齐 ArcGIS `VectorTileLayer.url`**。支持传入包含 `{z}/{x}/{y}` 的切片模板。 |
| `opacity` | `number` | `1` | 图层不透明度 (`0 ~ 1`)，**完全对齐 ArcGIS `VectorTileLayer.opacity`**。支持平滑渐变，无刷新闪烁。 |
| `visible` | `boolean` | `true` | 图层显隐状态，**完全对齐 ArcGIS `VectorTileLayer.visible`**。 |
| `index` | `number` | `undefined` | ArcGIS 模式下的图层层级索引（映射至 `view.map.add(layer, index)`）。 |
| `id` | `string` | `undefined` | 图层唯一 ID，**完全对齐 ArcGIS `VectorTileLayer.id`**。 |
| `title` | `string` | `undefined` | 图层标题（用于图层列表与图例组件），**完全对齐 ArcGIS `VectorTileLayer.title`**。 |
| `minScale` | `number` | `undefined` | 最小可见比例尺，**完全对齐 ArcGIS `VectorTileLayer.minScale`**。 |
| `maxScale` | `number` | `undefined` | 最大可见比例尺，**完全对齐 ArcGIS `VectorTileLayer.maxScale`**。 |
| `customParameters` | `Record<string, any>` | `undefined` | 自定义 URL 查询参数（例如 token、apikey 等），**完全对齐 ArcGIS `VectorTileLayer.customParameters`**。 |
| `blendMode` | `string` | `undefined` | 图层混合模式（如 `'multiply'`、`'screen'` 等），**完全对齐 ArcGIS `VectorTileLayer.blendMode`**。 |
| `effect` | `string` | `undefined` | 图层特效滤镜（如 `'drop-shadow(...)'`、`'bloom(...)'`），**完全对齐 ArcGIS `VectorTileLayer.effect`**。 |
| `listMode` | `'show' \| 'hide' \| 'hide-children'` | `undefined` | 图层在 LayerList 列表中的显示方式。 |
| `legendEnabled` | `boolean` | `true` | 是否在 Legend 图例控件中显示。 |
| `tileUrl` | `string` | `undefined` | 可选，用于覆盖样式中数据源切片地址（例如动态注入 token 或切换服务器）。 |
| `beforeId` | `string` | `undefined` | MapLibre 模式下指定插入在哪个图层之前（映射至 `addLayer(layer, beforeId)`）。 |
| `view` | `MapView \| SceneView` | `undefined` | 可选，显式传入 ArcGIS 视图实例。若不传则自动通过 `inject('view')` 查找。 |

### `<MaplibreProvider>`

| 属性名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `options` | `Partial<MapOptions>` | `{}` | 透传给 `maplibre-gl.Map` 构造函数的初始化配置。 |
| `view` | `MapView` | `undefined` | 可选，显式传入 ArcGIS MapView 实例。若不传则自动通过 `inject('view')` 查找。 |

### 组件暴露方法与引用 (defineExpose)

#### `MvtRenderer`
- `isMapLibreMode`: `ComputedRef<boolean>` — 当前是否处于 MapLibre 渲染模式。
- `resolvedStyleObject`: `ComputedRef<Record<string, any> | null>` — 当前解析后最终生效的样式对象。
- `arcgisLayer`: `() => VectorTileLayer | null` — 获取内部创建的原生 ArcGIS `VectorTileLayer` 实例（仅在 ArcGIS 模式下有效）。

#### `MaplibreProvider`
- `map`: `ShallowRef<maplibregl.Map | null>` — 获取底层的 MapLibre GL 实例。
- `syncMap`: `() => void` — 手动强制触发一次从 ArcGIS MapView 到 MapLibre GL 的视角同步。

---

## 📄 开源协议

[MIT License](LICENSE) © 2026
