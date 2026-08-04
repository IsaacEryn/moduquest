# 사용 리소스와 출처

## 그래픽

외부 이미지 파일을 쓰지 않는다. 캐릭터·몹 스프라이트와 바닥·벽 타일은 전부 코드로
그린다 — 픽셀 배치와 색을 `src/render/sprites.ts`에 데이터로 두고 실행 시 캔버스에
그려 텍스처로 만든다. 저자극 모드의 낮은 채도 팔레트도 같은 데이터에서 계산한다.

원작자: 프로젝트 제작자 본인. 별도 라이선스 제약 없음.

## 소리

효과음 파일도 쓰지 않는다. 이동·타격·치유·승리 등 모든 소리는 Web Audio API로
실행 시 합성한다(`src/audio/sfx.ts`). 방향이 있는 소리는 PannerNode의 HRTF 모델로
공간에 배치해 헤드폰에서 전후좌우를 구분할 수 있게 했다.

원작자: 프로젝트 제작자 본인. 별도 라이선스 제약 없음.

## 글꼴

시스템 글꼴만 사용한다(Apple SD Gothic Neo, Noto Sans KR, 그 외 OS 기본 산세리프).
웹 글꼴을 내려받지 않으므로 별도 라이선스가 없다.

## 소프트웨어 의존성

| 이름 | 용도 | 라이선스 |
|---|---|---|
| [Phaser](https://phaser.io) 4.x | 2D 렌더링·씬 관리 | MIT |
| [Vite](https://vite.dev) 7.x | 번들러·개발 서버 | MIT |
| [TypeScript](https://www.typescriptlang.org) 5.x | 언어·타입 검사 | Apache-2.0 |
| [Vitest](https://vitest.dev) 4.x | 테스트 실행기 | MIT |

전부 개발·배포에 제약 없는 오픈소스 라이선스이며, 실행 파일에 포함되는 것은 Phaser뿐이다.
