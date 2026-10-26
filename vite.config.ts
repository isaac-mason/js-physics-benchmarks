import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig(({ isSsrBuild }) => ({
  base: './',
  plugins: [
    wasm(),
    // node has top-level await; the headless bundle (scripts/run.ts) keeps it native
    ...(isSsrBuild ? [] : [topLevelAwait()]),
  ],
  optimizeDeps: {
    // These ship their own ESM + WASM — exclude from Vite's dep pre-bundling
    exclude: ['@dimforge/rapier3d-simd', 'jolt-physics'],
  },
  build: {
    target: 'esnext'
  }
}))
