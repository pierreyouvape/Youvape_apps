import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import appVersions, { socleChunk } from './vite-plugin-app-versions.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appVersions()],
  build: {
    rollupOptions: {
      output: { manualChunks: socleChunk() },
    },
  },
})
