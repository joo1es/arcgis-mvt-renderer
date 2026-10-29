/**
 * MapLibre 引擎注册入口
 *
 * 使用方式：
 *   import 'maplibre-gl/dist/maplibre-gl.css'
 *   import 'arcgis-mvt-renderer/maplibre'
 *
 * 该入口会静态引入 maplibre-gl 并通过 globalThis 完成交接。
 * 主入口 `arcgis-mvt-renderer` 不含任何 maplibre 引用，
 * 因此不使用 MapLibre 的项目无需安装它。
 */
import maplibregl from 'maplibre-gl'
import { MAPLIBRE_GLOBAL_KEY } from '../core/engineKeys'

;(globalThis as any)[MAPLIBRE_GLOBAL_KEY] = maplibregl

export { maplibregl }
export default maplibregl
