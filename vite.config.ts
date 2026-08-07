import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/*
  자산을 상대 경로로 낸다.
  이러면 같은 빌드 결과가 하위 경로(/moduquest/)에서도, 도메인 뿌리(/)에서도
  그대로 열린다 — 주소를 옮기는 동안 어느 쪽도 죽지 않는다는 뜻이다.
  경로를 고정해야 할 일이 생기면 BASE_PATH로 덮어쓴다.

  엔트리는 둘이다: 게임(index)과 운영(admin). admin.html은 배포 단계에서
  비밀 이름으로 바뀌어 올라간다 — 상대 경로 덕에 이름을 바꿔도 자산 참조가 산다.
*/
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  /*
    개발 서버 포트는 환경이 정해줄 수 있게 열어 둔다.

    감시 대상에서도 워크트리를 뺀다. 그 안의 사본이 바뀔 때마다 이쪽 서버가
    통째로 새로고침돼서, 멀티 플레이를 띄워 두고 확인하는 중에 한쪽 창이
    타이틀로 튕겼다 — 세션이 끊기고 그 자리는 대행으로 넘어간다.
    내 화면이 남의 작업에 흔들리지 않아야 한다.
  */
  server: {
    port: Number(process.env.PORT) || 5173,
    watch: { ignored: ['**/.claude/**'] },
  },
  preview: { port: Number(process.env.PORT) || 4173 },

  test: {
    /*
      작업용 워크트리(.claude/worktrees/)에는 저장소의 낡은 사본이 통째로 들어 있다.
      기본 설정은 그것까지 훑어서, 내 컴퓨터에서는 테스트가 두 배로 세어지고
      CI에서는 제대로 세어졌다 — 같은 명령이 장소에 따라 다른 수를 말한 셈이다.
      그 수를 문서에 옮겨 적었다가 틀렸으므로, 세는 자리부터 못 어긋나게 막는다.
    */
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
