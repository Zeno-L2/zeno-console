import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // No plugin-level globals: they are injected into every module, and the
    // linked packages cannot resolve the plugin's shims. main.ts sets the
    // three globals the SDK needs instead.
    nodePolyfills({
      include: ['crypto', 'buffer', 'stream', 'util'],
      globals: { Buffer: false, global: false, process: false },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    // One copy of vue must serve the app and nom-ui, or
    // injection and reactivity break.
    dedupe: ['vue', 'vue-router'],
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    exclude: ['znn-typescript-sdk', 'zeno-client', 'nom-ui'],
  },
  worker: {
    format: 'es',
  },
})
