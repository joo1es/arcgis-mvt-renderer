# arcgis-mvt-renderer

<p align="center">
  <b>Seamless MVT (Mapbox Vector Tile) rendering integration between ArcGIS Maps SDK and MapLibre GL / Mapbox GL.</b><br>
  <i>Use as a pure TypeScript/JS Class (Vanilla JS, React, Angular) or as Vue 3 Components. Zero runtime dependencies.</i>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> | <b>English</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/arcgis-mvt-renderer"><img src="https://img.shields.io/npm/v/arcgis-mvt-renderer.svg" alt="npm version"></a>
  <a href="https://joo1es.github.io/arcgis-mvt-renderer/"><img src="https://img.shields.io/badge/Live%20Demo-Online-success?style=flat&logo=google-chrome" alt="Live Demo"></a>
  <a href="https://developers.arcgis.com/javascript/"><img src="https://img.shields.io/badge/@arcgis/core-4.x-blue.svg" alt="arcgis"></a>
  <a href="https://maplibre.org/"><img src="https://img.shields.io/badge/maplibre--gl-3.x%20--%205.x-teal.svg" alt="maplibre"></a>
  <a href="https://www.mapbox.com/"><img src="https://img.shields.io/badge/mapbox--gl-supported-black.svg" alt="mapbox"></a>
  <a href="https://github.com/vuejs/core"><img src="https://img.shields.io/badge/vue-3.x-brightgreen.svg" alt="vue 3"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/arcgis-mvt-renderer.svg" alt="license"></a>
</p>

> 🚀 **Live Interactive Demo**: [https://joo1es.github.io/arcgis-mvt-renderer/](https://joo1es.github.io/arcgis-mvt-renderer/)

---

## 💡 Why `arcgis-mvt-renderer`?

When working with third-party or custom MVT (Mapbox Vector Tile) services in **ArcGIS Maps SDK for JavaScript**, you will encounter a fatal issue: **solid polygon fills (`type: "fill"`) fail to render or become completely invisible**, while outline strokes (`type: "line"`) render fine.

### Root Cause
- **MVT 2.1 Specification vs. ArcGIS Strictness**: In screen tile pixel coordinates (where Y points downwards), exterior polygon rings **must be Clockwise (CW)**, and interior rings (holes) must be **Counter-Clockwise (CCW)**.
- **The Winding Order Bug**: Most GIS cut-tile pipelines (PostGIS `ST_AsMVT`, GeoServer, custom Python/Go tile scripts) export exterior rings with counter-clockwise orientation (standard OGC Cartesian convention). ArcGIS's WebGL tessellator strictly treats CCW exterior rings as "unbounded interior holes," generating **zero triangles (`triangleCount: 0`)** — rendering solid fills completely invisible!
- **The Solution**: MapLibre GL and Mapbox GL use the robust `earcut` polygon tessellation algorithm, which effortlessly handles arbitrary winding orders and self-intersecting polygons.

`arcgis-mvt-renderer` bridges both worlds:
1. **Pure TypeScript/JS Class by Default**: Export `ArcGISMvtLayer` directly. Works in **Vanilla JS, React, Angular, Vue, or any web framework**.
2. **First-Class Vue 3 Support**: Optional `<MvtRenderer>` and `<MaplibreProvider>` components with full reactive bindings.
3. **Multi-Engine Support (`engine`)**: Supports `engine="maplibre"` (default) or `engine="mapbox"`, plus fallback `engine="arcgis"`.
4. **Shared WebGL Context Pool**: Multiple instances on the same ArcGIS view automatically share **a single engine instance and 1 WebGL canvas**, completely eliminating WebGL context limit issues (8~16 context browser limit)!
5. **Zero Runtime Dependencies**: Completely free of third-party runtime dependencies.

---

## 🌟 Features

- 💎 **Framework-Agnostic Core**: Default export is the pure JS/TS class `ArcGISMvtLayer`. Zero UI framework lock-in.
- ⚡ **Multi-Engine Support (`engine`)**:
  - `engine="maplibre"` (Default): High-performance open-source MapLibre GL pipeline.
  - `engine="mapbox"`: Use Mapbox GL JS with full Style Spec and 3D globe capabilities.
  - `engine="arcgis"`: Native `VectorTileLayer` mode.
- 🛡️ **Singleton WebGL Context Pool**: Multiple layers on the same view share **1 canvas and 1 WebGL context** through automatic reference counting.
- 🔄 **Real-Time Camera Synchronization**: Coordinates `center`, `zoom`, `resolution`, and `bearing` between ArcGIS MapView and MapLibre/Mapbox.
- 🎯 **Standard `:style` Prop**: Pass standard Mapbox Style Spec v8 JSON objects or remote `style.json` URLs without custom transformations.
- 📦 **0 Runtime Dependencies & Full TypeScript Support**: Comprehensive `.d.ts` declarations included.

---

## 📦 Installation

```bash
# Using pnpm
pnpm add arcgis-mvt-renderer

# Using npm
npm install arcgis-mvt-renderer

# Using yarn
yarn add arcgis-mvt-renderer
```

### Peer Dependencies
Make sure your project has the required peer dependencies installed:

```bash
pnpm add vue maplibre-gl @arcgis/core
```

---

## 🚀 Quick Start

### Option 1: Pure TypeScript / JavaScript Class (Default Export — React, Angular, Vanilla TS)

Zero Vue dependency! Use `ArcGISMvtLayer` directly in any web application:

```typescript
import ArcGISMvtLayer from 'arcgis-mvt-renderer'
// or: import { ArcGISMvtLayer } from 'arcgis-mvt-renderer'
import MapView from '@arcgis/core/views/MapView'
import Map from '@arcgis/core/Map'

const view = new MapView({
  container: 'viewDiv',
  map: new Map({ basemap: 'satellite' }),
  center: [114.3, 30.5],
  zoom: 10
})

// Initialize the MVT layer and mount onto ArcGIS MapView
const mvtLayer = new ArcGISMvtLayer({
  view: view,
  style: 'https://your-server.com/v1/style.json',
  engine: 'maplibre', // or 'mapbox'
  opacity: 0.8,
  visible: true,
})

// Programmatic Imperative API:
await mvtLayer.setStyle(anotherStyleObj)
mvtLayer.setOpacity(0.5)
mvtLayer.setVisible(false)
mvtLayer.destroy() // Releases layer & automatically recycles WebGL context
```

### Option 2: Vue 3 Components

#### Global Registration (Optional)

```typescript
// main.ts
import { createApp } from 'vue'
import { plugin as ArcGISMvtRenderer } from 'arcgis-mvt-renderer'
import App from './App.vue'

const app = createApp(App)
app.use(ArcGISMvtRenderer)
app.mount('#app')
```

#### Single Component Usage (Recommended — Default `engine="maplibre"`)

Simply pass `:view` and `:style`. Multiple components on the same view automatically share a single WebGL canvas and context:

```vue
<template>
  <div ref="mapContainer" class="map-view">
    <!-- Zero nesting required! Automatically renders via MapLibre and shares 1 WebGL context -->
    <MvtRenderer
      :view="arcgisView"
      :style="vectorTileStyle"
      tile-url="https://your-server.com/v1/mvt/{z}/{x}/{y}.pbf"
    />

    <!-- Add as many layers as you want; all share the single WebGL context -->
    <MvtRenderer
      :view="arcgisView"
      :style="buildingStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MapView from '@arcgis/core/views/MapView'
import Map from '@arcgis/core/Map'
import { MvtRenderer } from 'arcgis-mvt-renderer'

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

// Standard Mapbox Style Spec v8 object (or a URL string pointing to style.json)
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

#### Mode B: Inside `@vuesri/core` (Zero Configuration)

If you are using `@vuesri/core`, `<MvtRenderer>` automatically discovers the parent `MapView` via `inject('view')`. You do **not** need to pass `:view`:

```vue
<template>
  <VaMapView :default-options="mapOptions">
    <!-- Automatically binds to parent VaMapView -->
    <MvtRenderer :style="vectorTileStyle" />

    <!-- Base layers and other graphics -->
    <VaTdtBasemap :type="'vec_w'" />
  </VaMapView>
</template>

<script setup lang="ts">
import { MvtRenderer } from 'arcgis-mvt-renderer'
// ...
</script>
```

#### Mode C: Native ArcGIS Mode & 3D Globe (`SceneView`)

Configure `engine="arcgis"`, or use in a 3D digital globe (`SceneView`), where `<MvtRenderer>` automatically drapes vector tiles onto the spherical 3D globe surface:

```vue
<template>
  <div ref="sceneContainer" class="map-view">
    <!-- Draped naturally on the 3D globe surface -->
    <MvtRenderer
      :view="sceneView"
      engine="arcgis"
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

> **💡 Best Practice (Zoom Constraints)**:
> In 2D `MapView`, we recommend configuring `constraints: { minZoom: 2, maxZoom: 18, snapToZoom: false }` on the host MapView to prevent over-zooming out beyond valid Mercator projection tile scales.

---

## 🌐 Spatial Reference & Coordinate Systems

| Coordinate System | Examples | Recommended Mode | Description |
| :--- | :--- | :--- | :--- |
| **Web Mercator** | `EPSG:3857` / `WKID:102100` / Tianditu Mercator (`_w`) | **MapLibre Mode** or **ArcGIS Native Mode** | **Fully supported**. MapLibre GL is natively built on the Web Mercator quadtree tiling scheme with 100% viewpoint alignment. |
| **Geographic (Lat/Long)** | `CGCS2000 (WKID:4490)` / `WGS84 (EPSG:4326)` / Tianditu Geo (`_c`) | **ArcGIS Native Mode** (`<MvtRenderer>`) | **Fully supported via Native Mode**. ArcGIS `VectorTileLayer` natively handles 4490/4326 tiling schemes. MapLibre lacks equirectangular plate-carrée tiling pipelines and will distort latitudes under 4490. |
| **Projected / Local Grids** | Gauss-Krüger 3-degree zones / Local city coordinate systems | **ArcGIS Native Mode** (`<MvtRenderer>`) | **Fully supported via Native Mode**. As long as the vector tiles publish a matching tiling scheme, native ArcGIS renders them accurately. |

---

## 📖 API Reference

### `ArcGISMvtLayer` (Pure JS Class) & `<MvtRenderer>` (Vue Component)

Both the pure JS class and Vue component share identical property options:

| Prop / Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `engine` | `'auto' \| 'maplibre' \| 'mapbox' \| 'arcgis'` | `'auto'` | Rendering engine mode. Defaults to `'auto'` (automatically detects whether `maplibre-gl` or `mapbox-gl` is installed in the project and initializes the appropriate WebGL engine; safely falls back to native ArcGIS mode if neither is installed or in 3D `SceneView`). |
| `accessToken` | `string` | `undefined` | Mapbox Access Token (when `engine="mapbox"` is used). |
| `engineInstance` | `any` | `undefined` | Optional direct reference to `maplibregl` or `mapboxgl` library module. |
| `style` | `string \| Record<string, any>` | `undefined` | Standard Mapbox/ArcGIS Style Spec v8 object, JSON string, or remote `style.json` URL. Mutually interchangeable with `url`. |
| `url` | `string` | `undefined` | Vector tile service URL or style JSON URL, **fully aligned with ArcGIS `VectorTileLayer.url`**. Supports `{z}/{x}/{y}` tile template strings. |
| `opacity` | `number` | `1` | Layer opacity (`0 ~ 1`), **fully aligned with ArcGIS `VectorTileLayer.opacity`**. Enables smooth fading without flickering or reloading tiles. |
| `visible` | `boolean` | `true` | Visibility state of the layer, **fully aligned with ArcGIS `VectorTileLayer.visible`**. |
| `index` | `number` | `undefined` | Layer ordering index in ArcGIS mode (corresponds to `view.map.add(layer, index)`). |
| `id` | `string` | `undefined` | Unique layer ID, **fully aligned with ArcGIS `VectorTileLayer.id`**. |
| `title` | `string` | `undefined` | Layer title for LayerList & Legend widgets, **fully aligned with ArcGIS `VectorTileLayer.title`**. |
| `minScale` | `number` | `undefined` | Minimum visible scale, **fully aligned with ArcGIS `VectorTileLayer.minScale`**. |
| `maxScale` | `number` | `undefined` | Maximum visible scale, **fully aligned with ArcGIS `VectorTileLayer.maxScale`**. |
| `customParameters` | `Record<string, any>` | `undefined` | Custom query parameters appended to requests (e.g. token, apikey), **fully aligned with ArcGIS `VectorTileLayer.customParameters`**. |
| `blendMode` | `string` | `undefined` | Layer compositing blend mode (`'multiply'`, `'screen'`, etc.), **fully aligned with ArcGIS `VectorTileLayer.blendMode`**. |
| `effect` | `string` | `undefined` | Layer CSS/shader effect filter (`'drop-shadow(...)'`, `'bloom(...)'`), **fully aligned with ArcGIS `VectorTileLayer.effect`**. |
| `listMode` | `'show' \| 'hide' \| 'hide-children'` | `undefined` | Visibility in ArcGIS LayerList widget. |
| `legendEnabled` | `boolean` | `true` | Whether the layer is displayed in Legend widget. |
| `tileUrl` | `string` | `undefined` | Optional tile URL template to override sources' tile endpoints. |
| `beforeId` | `string` | `undefined` | Layer ID before which to insert this layer in MapLibre mode (corresponds to `addLayer(layer, beforeId)`). |
| `view` | `MapView \| SceneView` | `undefined` | Explicitly provide ArcGIS View instance. Defaults to auto-resolving via `inject('view')`. |

### `<MaplibreProvider>`

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `options` | `Partial<MapOptions>` | `{}` | Initialization options forwarded to `maplibre-gl.Map`. |
| `view` | `MapView` | `undefined` | Optional. Explicitly provide ArcGIS MapView instance. Defaults to auto-resolving via `inject('view')`. |

### Exposed Methods & Refs

#### `MvtRenderer`
- `isMapLibreMode`: `ComputedRef<boolean>` — Indicates whether the component is currently rendering via MapLibre GL.
- `resolvedStyleObject`: `ComputedRef<Record<string, any> | null>` — The normalized style object currently applied.
- `arcgisLayer`: `() => VectorTileLayer | null` — Access to the underlying ArcGIS `VectorTileLayer` instance (when in ArcGIS mode).

#### `MaplibreProvider`
- `map`: `ShallowRef<maplibregl.Map | null>` — Access to the underlying MapLibre GL map instance.
- `syncMap`: `() => void` — Manually forces viewpoint synchronization from ArcGIS MapView to MapLibre GL.

---

## 📄 License

[MIT License](LICENSE) © 2026
