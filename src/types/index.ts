/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InjectionKey, Ref, ShallowRef } from 'vue'

/**
 * MapLibre 实例的结构化类型。
 *
 * 刻意不使用 `import type { Map } from 'maplibre-gl'`：那会让发布的 .d.ts
 * 依赖 maplibre-gl 的类型包，导致未安装它的项目出现 TS 报错。
 * 本库承诺「主入口零 maplibre 依赖」，类型层面也保持一致。
 */
export type MapLibreMapLike = any
/** MapLibre 初始化选项的结构化类型（同上，避免类型包依赖） */
export type MapLibreOptionsLike = Record<string, any>

export type MvtEngineType = 'auto' | 'maplibre' | 'mapbox' | 'arcgis' | 'native-fixed'

export interface MvtRendererProps {
  /**
   * 渲染引擎模式
   * - 'auto' (**默认值**): 自动选择最优方案。优先使用「ArcGIS 原生 + Service Worker 绕向修正」
   *   （即 'native-fixed' 的等价行为）：零额外依赖、2D/3D 通用、面填充正常。
   *   仅当 Service Worker 不可用（非 HTTPS、未部署 mvt-sw.js 等）时，
   *   才退回依赖探测：maplibre-gl → mapbox-gl → 原生 'arcgis'。
   * - 'native-fixed': 强制「原生 + 绕向修正」。同样使用 ArcGIS 原生 VectorTileLayer，
   *   但通过 Service Worker 在瓦片到达渲染器之前修正多边形绕向。3D 下可获得地形贴合、
   *   LOD、深度遮挡、图层列表与拾取等原生能力。代价：需在应用同源托管 `mvt-sw.js`，
   *   且样式能力受 ArcGIS 对 Mapbox Style Spec 的支持子集限制。
   * - 'arcgis': 强制纯原生渲染，不启用绕向修正。零依赖、最快，但第三方 CCW 绕向瓦片
   *   的面填充可能缺失（这正是本库要解决的核心问题）。
   * - 'maplibre': 强制使用 MapLibre GL 渲染管线，绕向容错最好；多图层共享 1 个 WebGL 上下文。
   * - 'mapbox': 强制使用 Mapbox GL JS 渲染管线（需 accessToken）。
   * @default 'auto'
   */
  engine?: MvtEngineType

  /**
   * Service Worker 脚本地址（仅 engine='native-fixed' 时使用）
   * 默认 '/mvt-sw.js'，需将 dist/mvt-sw.js 复制到应用的同源静态目录
   * @default '/mvt-sw.js'
   */
  swUrl?: string

  /**
   * Service Worker 作用域（仅 engine='native-fixed' 时使用）
   * 必须覆盖发起瓦片请求的页面路径
   * @default '/'
   */
  swScope?: string

  /**
   * 额外需要拦截的瓦片 URL 特征（字符串按正则片段处理）
   * 默认已覆盖 *.pbf 与包含 /mvt 的路径，通常无需配置
   */
  swTilePatterns?: (string | RegExp)[]

  /**
   * Mapbox Access Token（当 engine 为 'mapbox' 时使用，也可在外部配置 window.mapboxgl.accessToken）
   */
  accessToken?: string

  /**
   * 自定义地图引擎库实例（可选，例如直接传入 import mapboxgl from 'mapbox-gl' 或 maplibregl 对象）
   */
  engineInstance?: any

  /**
   * 矢量瓦片样式
   * 支持标准的 Mapbox/ArcGIS Style Spec v8 样式对象、JSON 字符串，或者远程 style.json 的 URL。
   * 也可与 url 属性互换使用。
   */
  style?: string | Record<string, any>

  /**
   * 矢量切片服务 URL 或样式 JSON 访问地址（完全对齐 ArcGIS VectorTileLayer.url 入参）
   * 若不传 style，则直接使用 url 作为样式请求地址；若传入包含 {z}/{x}/{y} 则自动作为瓦片切片数据源。
   */
  url?: string

  /**
   * 图层不透明度 (0 ~ 1)，对齐 ArcGIS VectorTileLayer.opacity
   */
  opacity?: number

  /**
   * 图层显隐状态，对齐 ArcGIS VectorTileLayer.visible
   */
  visible?: boolean

  /**
   * ArcGIS 模式下的图层层级索引 (对应 view.map.add(layer, index))
   */
  index?: number

  /**
   * 图层唯一标识 ID，对齐 ArcGIS VectorTileLayer.id
   */
  id?: string

  /**
   * 图层标题（用于图层列表 LayerList 与图例组件），对齐 ArcGIS VectorTileLayer.title
   */
  title?: string

  /**
   * 最小可见比例尺，对齐 ArcGIS VectorTileLayer.minScale
   */
  minScale?: number

  /**
   * 最大可见比例尺，对齐 ArcGIS VectorTileLayer.maxScale
   */
  maxScale?: number

  /**
   * 自定义请求参数字典（如 token, apikey 等），对齐 ArcGIS VectorTileLayer.customParameters
   */
  customParameters?: Record<string, any>

  /**
   * 图层混合模式（如 'normal' | 'multiply' | 'screen' 等），对齐 ArcGIS VectorTileLayer.blendMode
   */
  blendMode?: string

  /**
   * 图层特效滤镜（如 'drop-shadow(...)' | 'bloom(...)' 等），对齐 ArcGIS VectorTileLayer.effect
   */
  effect?: string

  /**
   * 图例中是否启用，对齐 ArcGIS VectorTileLayer.legendEnabled
   */
  legendEnabled?: boolean

  /**
   * 图层列表中显示模式 ('show' | 'hide' | 'hide-children')，对齐 ArcGIS VectorTileLayer.listMode
   */
  listMode?: 'show' | 'hide' | 'hide-children'

  /**
   * MapLibre / Mapbox 模式下指定插入在哪个图层之前（对应 map.addLayer(layer, beforeId)）
   */
  beforeId?: string

  /**
   * 可选：覆盖或注入矢量瓦片请求 URL（例如动态注入 token 或替换瓦片服务）
   */
  tileUrl?: string

  /**
   * 可选：显式传入当前 ArcGIS MapView / SceneView 实例；若不传则自动从父级 inject('view') 获取
   */
  view?: any
}

/**
 * 纯 JS/TS 原生 ArcGISMvtLayer 类的初始化配置项
 */
export interface ArcGISMvtLayerOptions extends MvtRendererProps {
  /**
   * 必须提供的宿主 ArcGIS View 实例（MapView 或 SceneView）
   */
  view: any
}

export interface MaplibreProviderProps {
  /**
   * 透传给 MapLibre GL 的初始化选项
   */
  options?: Partial<MapLibreOptionsLike>

  /**
   * 可选：显式传入当前 ArcGIS MapView 实例；若不传则自动从父级 inject('view') 获取
   */
  view?: any

  /**
   * 是否自动挂载至 ArcGIS View 的 DOM 层级内部（介于底层画布与顶层 UI 控件之间）
   * @default true
   */
  attachToView?: boolean
}

export type MaplibreContext = Ref<MapLibreMapLike | null> | ShallowRef<MapLibreMapLike | null>

export const MAPLIBRE_VIEW_KEY: InjectionKey<MaplibreContext> = Symbol('maplibre-view')
