/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Lets us write `import { Button } from '@/components/ui/Button'`
      // instead of brittle relative paths like '../../../components/ui/Button'.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // jsdom gives component tests a fake DOM. Pure-logic tests ignore it.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright owns end-to-end tests; keep Vitest out of that folder.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    /*
     * IMPORTANT: 'forks' instead of the default 'threads'.
     *
     * This project's absolute path contains spaces ("GIAN DANIEL SALUTA",
     * "code for solarbros"). Vitest's worker-thread pool fails to hand that
     * path to its workers on Windows and every run dies with
     * "Timeout waiting for worker to respond". The forks pool passes the path
     * correctly. Slightly slower to start, but it actually works.
     *
     * If the project is ever moved to a space-free path, this can go back to
     * the default.
     */
    pool: 'forks',
  },
})
