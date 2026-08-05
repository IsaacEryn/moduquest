import { describe, expect, it } from 'vitest'
import { AUTOSAVE_ON } from './autosaveEvents'
import type { GameEvent } from '../core/events'

/**
 * 저장 버튼이 없는 게임이라, 어떤 사건에 기록하는지가 곧 저장 기능의 명세다.
 * 진행도를 바꾸는 사건이 목록에서 빠지면 플레이어는 한 일을 잃는다.
 */
describe('자동 저장 대상', () => {
  const mustSave: GameEvent['type'][] = [
    'moved', // 걸어간 위치
    'checkpoint', // 쉼터 도달
    'mode', // 전투가 끝나 필드로 돌아온 순간 등
    'traitChanged', // 특성
    'itemUsed', // 가방 내용과 체력
    'equipChanged', // 착용 장비 — 입고 바로 창을 닫아도 남아야 한다
    'areaChanged', // 구역 — 넘자마자 껐다 켜도 그 구역에서 이어져야 한다
  ]

  it.each(mustSave)('%s는 저장을 부른다', (type) => {
    expect(AUTOSAVE_ON.has(type)).toBe(true)
  })

  it('화면 표현만 바뀌는 사건은 저장하지 않는다 — 쓸데없는 기록이 늘지 않게', () => {
    const renderOnly: GameEvent['type'][] = [
      'attacked',
      'healed',
      'manaSpent',
      'turnStart',
      'battleSummary',
      'optionsChanged',
    ]
    for (const type of renderOnly) expect(AUTOSAVE_ON.has(type), type).toBe(false)
  })
})
