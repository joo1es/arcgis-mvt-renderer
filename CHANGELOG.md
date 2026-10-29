# Changelog

## 0.3.0

### 新增

- **`engine: 'native-fixed'`**：ArcGIS 原生 `VectorTileLayer` 渲染 + Service Worker 在瓦片到达渲染器前修正多边形绕向。
  2D / 3D（`SceneView`）通用，且完全不依赖 MapLibre。
- **`dist/mvt-sw.js`**：自包含 Service Worker 产物（9.1 KiB，gzip 2.9 KiB），零依赖。
- **公开 API**：`fixTileWinding()`、`ensureTileFixer()`、`TileFixerHandle`、`FixStats`。
- **子入口 `arcgis-mvt-renderer/maplibre`**：一行完成 MapLibre 引擎注册。
- **`setMaplibre()` / `setMapbox()`**：手动注册引擎实例。
- **GitHub Actions 发布流水线**：`.github/workflows/publish.yml`（tag 触发、版本校验、产物校验、provenance 签名）。

### 变更

- 默认 `engine="auto"` 的解析顺序改为：**native-fixed →（SW 不可用时）maplibre → mapbox → 原生**。
- `maplibre-gl` 变为**真正可选**：
  - 主入口不再有静态 `import`，也不再有字面量 `import('maplibre-gl')`
  - 不再内联 maplibre 样式（原 70 KiB CSS 已移除）
  - `.d.ts` 不再引用 maplibre-gl 类型

### 破坏性变更

- 样式入口变更：`arcgis-mvt-renderer/dist/style.css` / `dist/arcgis-mvt-renderer.css`
  → **`arcgis-mvt-renderer/style.css`**（仅剩组件样式，约 0.2 KiB）。
- MapLibre 用户需显式注册引擎（子入口 / `setMaplibre()` / `engineInstance` 三选一），
  并自行 `import 'maplibre-gl/dist/maplibre-gl.css'`。
- `auto` 的默认行为改变：0.2.x 会优先使用 MapLibre，0.3.0 优先使用原生 + 绕向修正。
  如需保持旧行为，显式指定 `engine="maplibre"` 或 `engine="auto"` 之外的探测逻辑。

### 已知限制

- `native-fixed` 依赖 Service Worker，因此需要 **HTTPS 或 localhost**；内网 HTTP 部署不可用。
- 样式能力受 ArcGIS 对 Mapbox Style Spec 的支持子集限制，`text-field` / `line-dasharray` /
  `fill-pattern` 等尚未逐项验证。
- 修正后的瓦片字节与原始瓦片不同（顶点顺序改变导致 varint 长度变化），
  基于内容哈希 / ETag 的校验会失效。
