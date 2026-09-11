import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2021' },
  define: {
    // 注入 GUI 版本号（与 tauri.conf.json / Cargo.toml / iss 由 bump:gui 同步）
    __APP_VERSION__: JSON.stringify(pkg.version)
  }
});
