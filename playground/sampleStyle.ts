export interface StylePreset {
  name: string
  description: string
  center: [number, number]
  zoom: number
  tileUrl?: string
  style: Record<string, any>
}

/**
 * 预置测试矢量瓦片样式
 */
export const PRESETS: StylePreset[] = [
  {
    name: 'MapLibre Demo Countries (Polygon Fill)',
    description: '官方公开全球国家多边形面切片 (测试实心多边形与边框渲染)',
    center: [105, 35],
    zoom: 3,
    style: {
      version: 8,
      sources: {
        'demo-countries': {
          type: 'vector',
          tiles: ['https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'countries-fill',
          type: 'fill',
          source: 'demo-countries',
          'source-layer': 'countries',
          paint: {
            'fill-color': '#409EFF',
            'fill-opacity': 0.65,
          },
        },
        {
          id: 'countries-outline',
          type: 'line',
          source: 'demo-countries',
          'source-layer': 'countries',
          paint: {
            'line-color': '#1D4ED8',
            'line-width': 1.5,
          },
        },
      ],
    },
  },
  {
    name: 'OpenStreetMap Carto Vector Polygons',
    description: '建筑物与土地利用面矢量切片',
    center: [114.3055, 30.5928],
    zoom: 12,
    style: {
      version: 8,
      sources: {
        'openmaptiles': {
          type: 'vector',
          tiles: ['https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf'],
        },
      },
      layers: [
        {
          id: 'water-fill',
          type: 'fill',
          source: 'openmaptiles',
          'source-layer': 'countries',
          paint: {
            'fill-color': '#10B981',
            'fill-opacity': 0.5,
          },
        },
        {
          id: 'water-line',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'countries',
          paint: {
            'line-color': '#059669',
            'line-width': 2,
          },
        },
      ],
    },
  },
  {
    name: 'Custom Service (自定义测试源)',
    description: '可直接在下方输入自定义切片 URL 进行测试',
    center: [114.79, 30.91],
    zoom: 11,
    tileUrl: 'http://192.168.110.251:38080/v1/mvt/layer/mvt?layer=D20260529-000003-01&z={z}&x={x}&y={y}',
    style: {
      version: 8,
      sources: {
        'custom-mvt': {
          type: 'vector',
          tiles: ['http://192.168.110.251:38080/v1/mvt/layer/mvt?layer=D20260529-000003-01&z={z}&x={x}&y={y}'],
        },
      },
      layers: [
        {
          id: 'custom-polygon-fill',
          type: 'fill',
          source: 'custom-mvt',
          'source-layer': 'D20260529-000003-01',
          paint: {
            'fill-color': '#EC4899',
            'fill-opacity': 0.7,
          },
        },
        {
          id: 'custom-polygon-outline',
          type: 'line',
          source: 'custom-mvt',
          'source-layer': 'D20260529-000003-01',
          paint: {
            'line-color': '#9D174D',
            'line-width': 1.5,
          },
        },
      ],
    },
  },
]
