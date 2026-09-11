import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src/**/*.ts', 'src/**/*.vue'],
      copyDtsFiles: true,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ArcGISMvtRenderer',
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // 外部化依赖，不打包进产物中
      external: [
        'vue',
        'maplibre-gl',
        '@arcgis/core',
        /^@arcgis\/core\/.*/,
      ],
      output: {
        exports: 'named',
        globals: {
          vue: 'Vue',
          'maplibre-gl': 'maplibregl',
        },
      },
    },
  },
})
