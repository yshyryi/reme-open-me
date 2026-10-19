import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs → the same build works at / (local) and /reme-open-me/ (GitHub Pages)
  base: './',
  // host: true -> server is reachable from other devices on the LAN (phone)
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2020' },
});
