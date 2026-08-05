import { defineConfig } from 'vite'

// GitHub Pages는 /moduquest/ 하위 경로에서 서빙된다.
// 커스텀 도메인으로 옮길 때는 BASE_PATH=/ 로 빌드하면 된다.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/moduquest/',
  // 개발 서버 포트는 환경이 정해줄 수 있게 열어 둔다
  server: { port: Number(process.env.PORT) || 5173 },
  preview: { port: Number(process.env.PORT) || 4173 },
})
