import { describe, expect, it } from 'vitest'
import type { Game } from '../core/game'
import type { Combatant } from '../core/types'
import { memberLabel } from './memberLabel'

/**
 * 함께 하기에서 사람이 앉은 자리는 여럿이다. "(나)"를 isPlayer로 붙이면
 * 두 사람 몫에 다 붙어서, 화면으로도 낭독으로도 내가 누구인지가 사라진다.
 */

function member(seat: number, name: string, isPlayer: boolean): Combatant {
  return { id: name, name, side: 'ally', isPlayer, seat, hp: 1, maxHp: 1 } as Combatant
}

describe('내 자리 이름표', () => {
  it('내 자리에만 (나)가 붙는다 — 옆 사람도 사람이지만 내가 아니다', () => {
    const game = { localSeat: 0 } as Game
    expect(memberLabel(game, member(0, '힐러', true))).toBe('힐러 (나)')
    expect(memberLabel(game, member(1, '힐러 2', true))).toBe('힐러 2')
    expect(memberLabel(game, member(2, '힐러 3', false))).toBe('힐러 3')
  })

  it('게스트 화면에서는 자기 자리에 붙는다', () => {
    const game = { localSeat: 1 } as Game
    expect(memberLabel(game, member(0, '힐러', true))).toBe('힐러')
    expect(memberLabel(game, member(1, '힐러 2', true))).toBe('힐러 2 (나)')
  })

  it('내 자리가 잠시 대행 중이어도 내 자리다', () => {
    const game = { localSeat: 1 } as Game
    expect(memberLabel(game, member(1, '힐러 2', false))).toBe('힐러 2 (나)')
  })
})
