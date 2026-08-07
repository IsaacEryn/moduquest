# 모두의 원정대 (ModuQuest)

여러 유형의 플레이어(비장애인·시각장애인·청각장애인·ADHD·ASD·인지장애)가 같은 파티로
동시에 즐기는 접근성 우선 멀티플레이 RPG. 웹으로 만들어 GitHub Pages에 올라가 있다.

## 현재 단계

**구현 단계.** 세 스테이지와 함께 하기(락스텝 멀티플레이)까지 동작한다.
`npm run dev`로 띄우고, `npm test`(vitest)와 `npx tsc --noEmit`이 게이트다.
배포는 main에 push하면 `.github/workflows/deploy.yml`이 한다.

## 문서 위치

설계 문서는 공개돼 있다: **`docs/`**. 루트 README는 플레이어용 소개다.

- `docs/01-vision.md` — 비전, 핵심 원칙("같은 세계, 다른 렌즈", 핸디캡은 과하지 않게)
- `docs/02-players.md` — 6개 사용자 유형별 경험 설계
- `docs/03-game-design.md` — 턴제 전투, 밸런스, 직업, 스토리, 함께 하기 규칙
- `docs/04-architecture.md` — 레이어 구조, 락스텝 동기화, 보안 경계
- `docs/05-accessibility.md` — 접근성 구현 노트
- `docs/06-decisions.md` — 한 번 정했다가 다시 본 결정들과 그때 무엇으로 확인했는지

작업용 비공개 문서는 **`.private/`**(gitignore됨)에 둔다. 그 내용을 공개 산출물이나
커밋 메시지로 옮기지 않는다 — 요약이나 인용도 마찬가지다.

## 확정된 기술 방향

- **Phaser 4** + TypeScript + Vite. "캔버스=시각, DOM=의미" 이중 레이어 —
  캔버스는 `aria-hidden`, 메뉴·전투·대화는 시맨틱 HTML + ARIA live region,
  공간 음향은 PannerNode HRTF. 효과음과 배경음악은 음원 파일 없이 Web Audio로 합성
- 멀티플레이: **Supabase Realtime** 호스트 시퀀서 락스텝(Broadcast=명령, Presence=로비)
- 호스팅: GitHub Pages(정적) + Supabase(Auth·RLS). 시크릿은 Actions Secrets에만
- **Unity WebGL 배제** (브라우저 스크린리더 접근 불가). 밸런스·스키마를 전부 데이터로
  관리하는 것은 언젠가 네이티브로 옮겨도 규칙이 살아남게 하려는 것이기도 하다

## 작업 규칙

- **무작위 금지.** 게임 로직에 `Math.random`을 쓰지 않는다. 확률로 보이는 것은 전부
  세는 규칙으로 번역한다(N번째 피격을 흘림, N번째 처치가 목록의 N번째 칸). 이 성질이
  락스텝 동기화의 토대이므로 예외를 만들면 멀티플레이가 무너진다
- **밸런스·핸디캡 수치는 코드가 아니라 `src/data`의 JSON.** 가방 상한·턴 간격·승리
  회복 비율까지 포함한다. 예외를 두면 그 예외가 저장 검증과 어긋난다(실제로 어긋났다)
- **화면에 보이는 수치는 데이터에서 조립한다.** 도움말에 손으로 적었을 때 실제로
  거짓말을 했다 — `src/ui/helpFacts.ts`가 조립하고 테스트가 데이터와 맞대 본다
- **소리를 내는 사건에는 자막이 있어야 한다.** `src/ui/captions.test.ts`가 강제한다
- `src/core`는 Phaser·DOM·window를 모른다. 타이머도 주입받는다
- 코어의 가드(can*, 좌석·토큰 검사)가 유효성의 최종 책임자다 — 버튼 비활성화에만
  기대면 원격 입력이 들어오는 순간 구멍이 된다
- `innerHTML`에 값을 보간하지 않는다(`textContent`를 쓸 것). CI가 막는다
- 글꼴을 바꾸면 `tools/subsetFonts.py`를 다시 돌린다. 지도를 바꾸면
  `tools/maps.md`를 고치고 `tools/buildStages.mjs`가 JSON을 만든다
- 로고·파비콘은 게임 스프라이트에서 만든다 — 캐릭터 그림을 고치면
  `npm run brand`(tools/buildBrand.mjs)를 다시 돌려 `public/brand/`를 갱신한다
