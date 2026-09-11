# arcgis-mvt-renderer

<p align="center">
  <b>Seamless MVT (Mapbox Vector Tile) rendering integration between ArcGIS Maps SDK and MapLibre GL for Vue 3.</b>
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> | <b>English</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/arcgis-mvt-renderer"><img src="https://img.shields.io/npm/v/arcgis-mvt-renderer.svg" alt="npm version"></a>
  <a href="https://joo1es.github.io/arcgis-mvt-renderer/"><img src="https://img.shields.io/badge/Live%20Demo-Online-success?style=flat&logo=google-chrome" alt="Live Demo"></a>
  <a href="https://github.com/vuejs/core"><img src="https://img.shields.io/badge/vue-3.x-brightgreen.svg" alt="vue 3"></a>
  <a href="https://developers.arcgis.com/javascript/"><img src="https://img.shields.io/badge/@arcgis/core-4.x-blue.svg" alt="arcgis"></a>
  <a href="https://maplibre.org/"><img src="https://img.shields.io/badge/maplibre--gl-3.x%20--%205.x-teal.svg" alt="maplibre"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/arcgis-mvt-renderer.svg" alt="license"></a>
</p>

---

## 💡 Why `arcgis-mvt-renderer`?

When working with third-party or custom MVT (Mapbox Vector Tile) services in **ArcGIS Maps SDK for JavaScript**, you may encounter a well-known issue: **solid polygon fills (`type: "fill"`) fail to render or become completely invisible**, while outline strokes (`type: "line"`) render fine.

### Root Cause
- **MVT 2.1 Specification**: According to the standard, in the screen tile grid (where Y points downwards), exterior polygon rings **must be Clockwise (CW)**, and interior rings (holes) must be **Counter-Clockwise (CCW)**.
- **ArcGIS Strictness vs. MapLibre Tolerance**: Many GIS cut-tile pipelines (e.g., PostGIS `ST_AsMVT` without `ST_ForcePolygonCW`, custom Python/Go tile scripts) export exterior rings with counter-clockwise orientation (standard OGC/Cartesian convention). ArcGIS's WebGL tessellator strictly drops CCW rings as "unbounded holes," generating zero triangles.
- **The Solution**: MapLibre GL uses the robust `earcut` polygon tessellation algorithm, which effortlessly handles non-standard winding orders and self-intersecting polygons.

`arcgis-mvt-renderer` bridges both worlds:
1. **Pass standard `:style`**: Accepts native Mapbox Style Spec v8 objects or remote `style.json` URLs.
2. **Dual-Mode Rendering**: Automatically syncs and renders with MapLibre GL when wrapped inside `<MaplibreProvider>`, and falls back to native `@arcgis/core/layers/VectorTileLayer` when running standalone.
3. **Completely Decoupled**: Zero proprietary wrapper dependencies. Native support for `@arcgis/core`, `@vuesri/core`, or vanilla Vue 3 projects.

---

## 🌟 Features

- 🎯 **Standard `:style` Prop**: Pass standard Mapbox Style Spec v8 JSON objects or remote `style.json` URLs without custom transformations.
- ⚡ **Dual-Mode Architecture**:
  - **MapLibre Mode**: Fixes polygon fill rendering issues using high-performance MapLibre GL, automatically synced with ArcGIS camera viewpoint.
  - **ArcGIS Native Mode**: Falls back to native `VectorTileLayer` when running without a provider.
- 🔄 **Real-Time Camera Synchronization**: Coordinates `center`, `zoom`, `resolution`, and `bearing` between ArcGIS MapView and MapLibre.
- 🛡️ **Scope Isolation**: Automatically assigns unique ID prefixes to added Sources and Layers to prevent namespace collisions when multiple renderer instances run simultaneously.
- 🧩 **Zero Framework Lock-in**: Automatically discovers ArcGIS MapView from props, `inject('view')`, or `@vuesri/core`, without coupling to any specific UI library.
- 📦 **Full TypeScript Support**: Comprehensive `.d.ts` declarations included.

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

### 1. Global Registration (Optional)

```typescript
// main.ts
import { createApp } from 'vue'
import ArcGISMvtRenderer from 'arcgis-mvt-renderer'
import App from './App.vue'

const app = createApp(App)
app.use(ArcGISMvtRenderer)
app.mount('#app')
```

### 2. Usage Examples

#### Mode A: With `MaplibreProvider` (Recommended — Fixes Polygon Fill Issues)

Wrap `<MvtRenderer>` with `<MaplibreProvider>`. The provider creates an overlay and keeps its viewpoint in sync with the ArcGIS MapView.

```vue
<template>
  <div ref="mapContainer" class="map-view">
    <!-- MaplibreProvider keeps MapLibre camera synchronized with arcgisView -->
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

#### Mode B: Inside `@vuesri/core` (Zero Configuration)

If you are using `@vuesri/core`, `<MaplibreProvider>` automatically discovers the parent `MapView` via `inject('view')`. You do **not** need to pass `:view`:

```vue
<template>
  <VaMapView :default-options="mapOptions">
    <!-- Automatically binds to VaMapView -->
    <MaplibreProvider>
      <MvtRenderer :style="vectorTileStyle" />
    </MaplibreProvider>

    <!-- Base layers and other graphics -->
    <VaTdtBasemap :type="'vec_w'" />
  </VaMapView>
</template>

<script setup lang="ts">
import { MaplibreProvider, MvtRenderer } from 'arcgis-mvt-renderer'
// ...
</script>
```

#### Mode C: Native ArcGIS Mode & 3D Globe (`SceneView`)

When used outside `<MaplibreProvider>`, or in a 3D digital globe (`SceneView`), `<MvtRenderer>` automatically mounts native `@arcgis/core/layers/VectorTileLayer`, seamlessly draping vector tiles onto the 3D spherical globe surface:

```vue
<template>
  <div ref="sceneContainer" class="map-view">
    <!-- Draped naturally on the 3D globe surface -->
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

> **💡 Best Practice (Zoom Constraints)**:
> In 2D `MapView` paired with `MaplibreProvider`, we recommend configuring `constraints: { minZoom: 2, maxZoom: 18, snapToZoom: false }` on the host MapView to prevent over-zooming out beyond valid Mercator projection tile scales.

---

## 🌐 Spatial Reference & Coordinate Systems

| Coordinate System | Examples | Recommended Mode | Description |
| :--- | :--- | :--- | :--- |
| **Web Mercator** | `EPSG:3857` / `WKID:102100` / Tianditu Mercator (`_w`) | **MapLibre Mode** or **ArcGIS Native Mode** | **Fully supported**. MapLibre GL is natively built on the Web Mercator quadtree tiling scheme with 100% viewpoint alignment. |
| **Geographic (Lat/Long)** | `CGCS2000 (WKID:4490)` / `WGS84 (EPSG:4326)` / Tianditu Geo (`_c`) | **ArcGIS Native Mode** (`<MvtRenderer>`) | **Fully supported via Native Mode**. ArcGIS `VectorTileLayer` natively handles 4490/4326 tiling schemes. MapLibre lacks equirectangular plate-carrée tiling pipelines and will distort latitudes under 4490. |
| **Projected / Local Grids** | Gauss-Krüger 3-degree zones / Local city coordinate systems | **ArcGIS Native Mode** (`<MvtRenderer>`) | **Fully supported via Native Mode**. As long as the vector tiles publish a matching tiling scheme, native ArcGIS renders them accurately. |

---

## 📖 API Reference

### `<MvtRenderer>` (Fully Aligned with ArcGIS `VectorTileLayer`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
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
