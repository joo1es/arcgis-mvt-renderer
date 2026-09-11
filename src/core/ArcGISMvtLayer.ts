/* eslint-disable @typescript-eslint/no-explicit-any */
import VectorTileLayer from '@arcgis/core/layers/VectorTileLayer'
import { acquireSharedEngine } from '../composables/useSharedMaplibre'
import type { ArcGISMvtLayerOptions, MvtEngineType } from '../types'

/**
 * 纯 TypeScript/JavaScript 原生类 ArcGISMvtLayer
 * 零前端框架依赖（React/Vue/Angular/Vanilla TS 均可通用），
 * 无缝桥接 ArcGIS Maps SDK 与 MapLibre GL / Mapbox GL 矢量瓦片渲染能力。
 */
export class ArcGISMvtLayer {
  public view: any
  public options: ArcGISMvtLayerOptions
  public engine: MvtEngineType

  private activeMapInstance: any = null
  private releaseSharedEngine: (() => void) | null = null
  private nativeArcgisLayer: VectorTileLayer | null = null

  private addedSourceIds: string[] = []
  private addedLayerIds: string[] = []
  private resolvedStyle: Record<string, any> | null = null
  private isDestroyed = false

  constructor(options: ArcGISMvtLayerOptions) {
    if (!options || !options.view) {
      throw new Error('[ArcGISMvtLayer] 必须提供有效的 ArcGIS View 实例作为 view 参数')
    }

    this.view = options.view
    this.options = { ...options }
    this.engine = this.resolveEffectiveEngine(options.engine)

    this.init()
  }

  /**
   * 判断实际生效的渲染引擎
   * 若为 3D SceneView，自动降级为 ArcGIS 原生模式贴地渲染
   */
  private resolveEffectiveEngine(engine?: MvtEngineType): MvtEngineType {
    if (this.view && this.view.type === '3d') {
      return 'arcgis'
    }
    return engine || 'maplibre'
  }

  /**
   * 是否处于 MapLibre / Mapbox 渲染模式
   */
  public get isMapMode(): boolean {
    return this.engine === 'maplibre' || this.engine === 'mapbox'
  }

  /**
   * 获取底层渲染器实例（MapLibre / Mapbox Map）
   */
  public getMapInstance(): any {
    return this.activeMapInstance
  }

  /**
   * 获取 ArcGIS 原生图层实例（当处于 arcgis 模式时可用）
   */
  public getArcgisLayer(): VectorTileLayer | null {
    return this.nativeArcgisLayer
  }

  /**
   * 获取解析后的完整 Mapbox Style Spec v8 样式对象
   */
  public getResolvedStyle(): Record<string, any> | null {
    return this.resolvedStyle
  }

  /**
   * 初始化并挂载图层
   */
  private async init(): Promise<void> {
    if (this.isDestroyed) return

    if (typeof this.view.when === 'function') {
      await this.view.when()
    }
    if (this.isDestroyed) return

    // 1. 解析样式对象
    await this.resolveStyleInput()

    // 2. 根据引擎模式执行挂载
    if (this.isMapMode) {
      await this.bindSharedEngine()
      this.applyMapLayers()
    } else {
      await this.syncArcgisLayer()
    }
  }

  /**
   * 解析 style / url 入参为样式对象
   */
  private async resolveStyleInput(): Promise<void> {
    const input = this.options.style || this.options.url
    if (!input) {
      this.resolvedStyle = null
      return
    }

    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (trimmed.startsWith('{')) {
        try {
          this.resolvedStyle = JSON.parse(trimmed)
        } catch (e) {
          console.error('[ArcGISMvtLayer] JSON style 解析失败:', e)
          this.resolvedStyle = null
        }
      } else {
        try {
          const res = await fetch(trimmed)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          this.resolvedStyle = await res.json()
        } catch (e) {
          console.error(`[ArcGISMvtLayer] 请求远程矢量瓦片样式失败 (${trimmed}):`, e)
          this.resolvedStyle = null
        }
      }
    } else if (typeof input === 'object') {
      this.resolvedStyle = JSON.parse(JSON.stringify(input))
    }

    // 处理 tileUrl 覆盖
    const tileUrl = this.options.tileUrl
    if (tileUrl && this.resolvedStyle?.sources) {
      Object.keys(this.resolvedStyle.sources).forEach((srcKey) => {
        const src = this.resolvedStyle!.sources[srcKey]
        if (src && (src.type === 'vector' || !src.type)) {
          src.tiles = [tileUrl]
        }
      })
    }
  }

  /**
   * 从单例池中绑定共享 MapLibre / Mapbox 实例
   */
  private async bindSharedEngine(): Promise<void> {
    if (this.activeMapInstance) return

    try {
      const { map, release } = await acquireSharedEngine(this.view, {
        engine: this.engine,
        accessToken: this.options.accessToken,
        engineInstance: this.options.engineInstance,
      })
      this.activeMapInstance = map
      this.releaseSharedEngine = release
    } catch (e) {
      console.error('[ArcGISMvtLayer] 绑定共享地图引擎异常:', e)
    }
  }

  /**
   * 将样式图层应用至 MapLibre / Mapbox 实例
   */
  private applyMapLayers(): void {
    const map = this.activeMapInstance
    const styleObj = this.resolvedStyle
    if (!map || !styleObj || this.isDestroyed) return

    const apply = () => {
      this.removeMapLayers()

      const prefix = `mvt-${Math.random().toString(36).slice(2, 7)}-${Date.now()}`
      const sourceIdMap: Record<string, string> = {}

      // 1. 添加 Sources
      if (styleObj.sources && typeof styleObj.sources === 'object') {
        Object.keys(styleObj.sources).forEach((origSourceId) => {
          const uniqueSourceId = `${prefix}-${origSourceId}`
          sourceIdMap[origSourceId] = uniqueSourceId
          map.addSource(uniqueSourceId, styleObj.sources[origSourceId])
          this.addedSourceIds.push(uniqueSourceId)
        })
      }

      // 2. 字体 (Glyphs)
      if (styleObj.glyphs && typeof map.getStyle === 'function' && !map.getStyle()?.glyphs) {
        if (typeof map.setGlyphs === 'function') {
          map.setGlyphs(styleObj.glyphs)
        }
      }

      // 3. 添加 Layers
      if (Array.isArray(styleObj.layers)) {
        const isVisible = this.options.visible !== false
        styleObj.layers.forEach((layer: any) => {
          const newLayer = JSON.parse(JSON.stringify(layer))
          if (newLayer.source && sourceIdMap[newLayer.source]) {
            newLayer.source = sourceIdMap[newLayer.source]
          }
          newLayer.id = `${prefix}-${newLayer.id}`

          if (!newLayer.layout) newLayer.layout = {}
          newLayer.layout['visibility'] = isVisible ? 'visible' : 'none'

          if (typeof this.options.opacity === 'number') {
            if (!newLayer.paint) newLayer.paint = {}
            if (newLayer.type === 'fill') newLayer.paint['fill-opacity'] = this.options.opacity
            else if (newLayer.type === 'line') newLayer.paint['line-opacity'] = this.options.opacity
            else if (newLayer.type === 'circle') newLayer.paint['circle-opacity'] = this.options.opacity
          }

          const validBeforeId =
            this.options.beforeId && map.getLayer(this.options.beforeId)
              ? this.options.beforeId
              : undefined

          map.addLayer(newLayer, validBeforeId)
          this.addedLayerIds.push(newLayer.id)
        })
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('styledata', apply)
    }
  }

  /**
   * 移除已添加至 MapLibre / Mapbox 的图层与源
   */
  private removeMapLayers(): void {
    const map = this.activeMapInstance
    if (!map) return

    for (let i = this.addedLayerIds.length - 1; i >= 0; i--) {
      const layerId = this.addedLayerIds[i]
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId)
      }
    }
    this.addedLayerIds = []

    this.addedSourceIds.forEach((sourceId) => {
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId)
      }
    })
    this.addedSourceIds = []
  }

  /**
   * 挂载并同步 ArcGIS 原生 VectorTileLayer
   */
  private async syncArcgisLayer(): Promise<void> {
    this.removeArcgisLayer()
    if (!this.view || this.isDestroyed) return
    if (!this.resolvedStyle && !this.options.url) return

    if (typeof this.view.when === 'function') {
      await this.view.when()
    }
    if (!this.view.map || this.isDestroyed) return

    const layerOptions: Record<string, any> = {}

    if (this.resolvedStyle) {
      layerOptions.style = this.resolvedStyle
    } else if (this.options.url) {
      layerOptions.url = this.options.url
    }

    if (typeof this.options.opacity === 'number') layerOptions.opacity = this.options.opacity
    if (typeof this.options.visible === 'boolean') layerOptions.visible = this.options.visible
    if (typeof this.options.minScale === 'number') layerOptions.minScale = this.options.minScale
    if (typeof this.options.maxScale === 'number') layerOptions.maxScale = this.options.maxScale
    if (this.options.title) layerOptions.title = this.options.title
    if (this.options.id) layerOptions.id = this.options.id
    if (this.options.customParameters) layerOptions.customParameters = this.options.customParameters
    if (this.options.blendMode) layerOptions.blendMode = this.options.blendMode as any
    if (this.options.effect) layerOptions.effect = this.options.effect as any
    if (this.options.listMode) layerOptions.listMode = this.options.listMode
    if (typeof this.options.legendEnabled === 'boolean') {
      layerOptions.legendEnabled = this.options.legendEnabled
    }

    this.nativeArcgisLayer = new VectorTileLayer(layerOptions)

    if (typeof this.options.index === 'number') {
      this.view.map.add(this.nativeArcgisLayer, this.options.index)
    } else {
      this.view.map.add(this.nativeArcgisLayer)
    }
  }

  /**
   * 移除 ArcGIS 原生图层
   */
  private removeArcgisLayer(): void {
    if (this.nativeArcgisLayer && this.view?.map) {
      this.view.map.remove(this.nativeArcgisLayer)
      this.nativeArcgisLayer.destroy()
      this.nativeArcgisLayer = null
    }
  }

  // ================= 开放命令式公共 API =================

  /**
   * 动态更新样式配置 (支持 Mapbox Style Spec v8 对象或远程 style.json URL)
   */
  public async setStyle(style: string | Record<string, any>): Promise<void> {
    this.options.style = style
    await this.resolveStyleInput()

    if (this.isMapMode) {
      this.applyMapLayers()
    } else {
      await this.syncArcgisLayer()
    }
  }

  /**
   * 动态覆盖瓦片 URL 模板
   */
  public async setTileUrl(tileUrl?: string): Promise<void> {
    this.options.tileUrl = tileUrl
    await this.setStyle(this.options.style || this.options.url || {})
  }

  /**
   * 动态调节不透明度 (0 ~ 1)，即时 GPU 更新无重载闪烁
   */
  public setOpacity(opacity: number): void {
    this.options.opacity = opacity

    if (!this.isMapMode && this.nativeArcgisLayer) {
      this.nativeArcgisLayer.opacity = opacity
    } else if (this.isMapMode && this.activeMapInstance) {
      const map = this.activeMapInstance
      this.addedLayerIds.forEach((layerId) => {
        const lyr = map.getLayer(layerId)
        if (lyr) {
          const type = lyr.type
          if (type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', opacity)
          else if (type === 'line') map.setPaintProperty(layerId, 'line-opacity', opacity)
          else if (type === 'circle') map.setPaintProperty(layerId, 'circle-opacity', opacity)
          else if (type === 'raster') map.setPaintProperty(layerId, 'raster-opacity', opacity)
        }
      })
    }
  }

  /**
   * 动态显隐控制
   */
  public setVisible(visible: boolean): void {
    this.options.visible = visible

    if (!this.isMapMode && this.nativeArcgisLayer) {
      this.nativeArcgisLayer.visible = visible
    } else if (this.isMapMode && this.activeMapInstance) {
      const map = this.activeMapInstance
      const val = visible ? 'visible' : 'none'
      this.addedLayerIds.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', val)
        }
      })
    }
  }

  /**
   * 动态切换渲染引擎 ('maplibre' | 'mapbox' | 'arcgis')
   */
  public async setEngine(engine: MvtEngineType): Promise<void> {
    const newEffective = this.resolveEffectiveEngine(engine)
    if (this.engine === newEffective) return

    // 清理前一个引擎的图层
    if (this.isMapMode) {
      this.removeMapLayers()
      if (this.releaseSharedEngine) {
        this.releaseSharedEngine()
        this.releaseSharedEngine = null
      }
      this.activeMapInstance = null
    } else {
      this.removeArcgisLayer()
    }

    this.engine = newEffective
    this.options.engine = engine

    if (this.isMapMode) {
      await this.bindSharedEngine()
      this.applyMapLayers()
    } else {
      await this.syncArcgisLayer()
    }
  }

  /**
   * 销毁图层与释放单例池计数
   */
  public destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true

    this.removeMapLayers()
    this.removeArcgisLayer()

    if (this.releaseSharedEngine) {
      this.releaseSharedEngine()
      this.releaseSharedEngine = null
    }
    this.activeMapInstance = null
  }
}

export default ArcGISMvtLayer
