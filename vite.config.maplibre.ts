import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * 独立构建 MapLibre 子入口 dist/engines/maplibre.js
 *
 * 只有这个入口会静态引用 maplibre-gl。主入口不含任何引用，
 * 因此未安装 maplibre-gl 的项目可以正常构建与打包。
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/engines/maplibre.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => `engines/maplibre.${format === 'es' ? 'js' : 'cjs'}`,
    },
    emptyOutDir: false,
    rollupOptions: {
      external: ['maplibre-gl'],
    },
  },
})
