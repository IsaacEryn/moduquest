import type { GameEvent } from '../core/events'

/**
 * 이 사건들이 나면 지금 자리에 자동으로 기록한다. 저장 버튼을 두지 않는 대신,
 * "되돌리면 아까운 것이 바뀌는 순간"을 빠짐없이 여기 적는 것이 규칙이다.
 *
 * 장비를 입고 바로 창을 닫아도 기록이 남아야 한다 — equipChanged가 빠져 있어
 * 다음 이동 전까지 착용이 저장되지 않던 적이 있다.
 */
export const AUTOSAVE_ON: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>([
  'moved',
  'checkpoint',
  'mode',
  'traitChanged',
  'itemUsed',
  'equipChanged',
])
