/**
 * 引擎交接键（纯常量，无状态）
 *
 * 子入口 `arcgis-mvt-renderer/maplibre` 与主入口可能被打包成两份独立产物，
 * 各自持有独立的模块状态。因此通过 globalThis 传递引擎实例，而不是共享模块变量。
 */
export const MAPLIBRE_GLOBAL_KEY = '__ARCGIS_MVT_MAPLIBRE__'
