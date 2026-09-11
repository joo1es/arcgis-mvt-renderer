/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { Map as MapLibreMap, MapOptions } from 'maplibre-gl'

export interface MvtRendererProps {
  /**
   * 渲染引擎模式
   * - 'maplibre' (默认值): 使用 MapLibre GL 矢量瓦片渲染管线，天然解决多边形绕向 (Winding Order) 缺失引起的面填充空白问题；多图层自动共享 1 个 WebGL 上下文。
   * - 'arcgis': 使用 ArcGIS 官方原生 VectorTileLayer 渲染。
   * 注意：3D SceneView 模式下将自适应降级使用 'arcgis' 原生模式进行球面贴地渲染。
   * @default 'maplibre'
   */
  engine?: 'maplibre' | 'arcgis'

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
   * MapLibre 模式下指定插入在哪个图层之前（对应 map.addLayer(layer, beforeId)）
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

export interface MaplibreProviderProps {
  /**
   * 透传给 MapLibre GL 的初始化选项
   */
  options?: Partial<MapOptions>

  /**
   * 可选：显式传入当前 ArcGIS MapView 实例；若不传则自动从父级 inject('view') 获取
   */
  view?: any

  /**
   * 是否自动挂载至 ArcGIS View 的 DOM 层级内部（介于底层画布与顶层 UI 控件之间）
   * @default true
   * - 默认为 true：自动通过 Teleport 挂载至 .esri-view-root 内部并保持在 .esri-ui 之下，零配置解决 UI 与 Powered by Esri 版权信息被遮挡问题
   * - 若为 false：保持在当前 Vue 模板位置渲染
   */
  attachToView?: boolean
}

export type MaplibreContext = Ref<MapLibreMap | null> | ShallowRef<MapLibreMap | null>

export const MAPLIBRE_VIEW_KEY: InjectionKey<MaplibreContext> = Symbol('maplibre-view')
