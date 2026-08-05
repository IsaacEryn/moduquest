# 사용 리소스와 출처

## 그래픽

외부 이미지 파일을 쓰지 않는다. 캐릭터·몹 스프라이트와 바닥·벽 타일은 전부 코드로
그린다 — 픽셀 배치와 색을 `src/render/sprites.ts`에 데이터로 두고 실행 시 캔버스에
그려 텍스처로 만든다. 저자극 모드의 낮은 채도 팔레트도 같은 데이터에서 계산한다.

원작자: 프로젝트 제작자 본인. 별도 라이선스 제약 없음.

## 소리

효과음 파일도 음원 파일도 쓰지 않는다. 이동·타격·치유·승리 등 모든 효과음은 Web Audio
API로 실행 시 합성하고(`src/audio/sfx.ts`), 배경음악도 손으로 적은 음표 데이터를 같은
방식으로 연주한다(`src/audio/music.ts`) — 곳마다 다른 곡이 언제나 같게 흐른다. 방향이
있는 소리는 PannerNode의 HRTF 모델로 공간에 배치해 헤드폰에서 전후좌우를 구분할 수
있게 했다.

원작자: 프로젝트 제작자 본인. 별도 라이선스 제약 없음.

## 글꼴

두 서체를 한글 서브셋으로 만들어 저장소 안에서 직접 제공한다(외부 호스트에서
내려받지 않는다).

| 서체 | 쓰임 | 라이선스 |
|---|---|---|
| [Galmuri11](https://galmuri.quiple.dev) | 제목 (픽셀 서체) | SIL OFL 1.1 |
| [Pretendard](https://github.com/orioncactus/pretendard) | 본문 | SIL OFL 1.1 |

둘 다 SIL Open Font License 1.1이라 임베드·재배포에 제약이 없다.

## 소프트웨어 의존성

| 이름 | 용도 | 라이선스 |
|---|---|---|
| [Phaser](https://phaser.io) 4.x | 2D 렌더링·씬 관리 | MIT |
| [supabase-js](https://github.com/supabase/supabase-js) 2.x | 함께 하기 — 인증·실시간 채널·선물함 | MIT |
| [Vite](https://vite.dev) 7.x | 번들러·개발 서버 | MIT |
| [TypeScript](https://www.typescriptlang.org) 5.x | 언어·타입 검사 | Apache-2.0 |
| [Vitest](https://vitest.dev) 4.x | 테스트 실행기 | MIT |

전부 개발·배포에 제약 없는 오픈소스 라이선스이며, 실행 파일에 포함되는 것은 Phaser와
supabase-js뿐이다. supabase-js는 함께 하기를 열 때에만 불려 온다 — 혼자 하는 실행은
이 코드를 읽지 않는다.
