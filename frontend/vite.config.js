import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bus Management App',
        short_name: 'BusApp',
        start_url: '/',
        display: 'standalone'
      }
    })
  ],
  server: {
    port: 5173
  }
})
