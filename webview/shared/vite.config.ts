import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const sharedRoot = __dirname

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        chat: path.resolve(__dirname, 'src/chat/index.tsx'),
        plan: path.resolve(__dirname, 'src/plan/index.tsx'),
        walkthrough: path.resolve(__dirname, 'src/walkthrough/index.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
    minify: false,
  },
  resolve: {
    // Keep a single React instance in the chat-only webview bundle to avoid invalid hook calls.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(sharedRoot, 'node_modules/react'),
      'react-dom': path.resolve(sharedRoot, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(sharedRoot, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(sharedRoot, 'node_modules/react/jsx-dev-runtime.js'),
    },
  },
})
