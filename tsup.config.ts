import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  clean: true,
  noExternal: [],
  skipNodeModulesBundle: true,
  outDir: 'dist',
  target: 'esnext'
})
