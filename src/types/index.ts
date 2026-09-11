/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { Map as MapLibreMap, MapOptions } from 'maplibre-gl'

export interface MvtRendererProps {
  /**
   * 传统的矢量瓦片样式
   * 支持标准的 Mapbox/ArcGIS Style Spec v8 样式对象、JSON 字符串，或者远程 style.json 的 URL
   */
  style: string | Record<string, any>

  /**
   * 图层透明度 (0 ~ 1)
   */
  opacity?: number

  /**
   * ArcGIS 模式下的图层层级索引 (对应 view.map.add(layer, index))
   */
  index?: number

  /**
   * MapLibre 模式下指定插入在哪个图层之前（对应 map.addLayer(layer, beforeId)）
   */
  beforeId?: string

  /**
   * 可选：覆盖或注入矢量瓦片请求 URL（例如动态注入 token 或替换瓦片服务）
   */
  tileUrl?: string

  /**
   * 可选：显式传入当前 ArcGIS MapView 实例；若不传则自动从父级 inject('view') 获取
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
}

export type MaplibreContext = Ref<MapLibreMap | null> | ShallowRef<MapLibreMap | null>

export const MAPLIBRE_VIEW_KEY: InjectionKey<MaplibreContext> = Symbol('maplibre-view')
