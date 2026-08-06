import { defineConfig } from 'vite'

/*
  자산을 상대 경로로 낸다.
  이러면 같은 빌드 결과가 하위 경로(/moduquest/)에서도, 도메인 뿌리(/)에서도
  그대로 열린다 — 주소를 옮기는 동안 어느 쪽도 죽지 않는다는 뜻이다.
  경로를 고정해야 할 일이 생기면 BASE_PATH로 덮어쓴다.
*/
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  // 개발 서버 포트는 환경이 정해줄 수 있게 열어 둔다
  server: { port: Number(process.env.PORT) || 5173 },
  preview: { port: Number(process.env.PORT) || 4173 },
})
