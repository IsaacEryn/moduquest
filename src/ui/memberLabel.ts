import type { Game } from '../core/game'
import type { Combatant } from '../core/types'

/**
 * 파티원 이름표에 "(나)"를 붙일지 정한다.
 *
 * 예전에는 `isPlayer`로 판단했다. 그것은 "사람이 조작하는 자리"라는 뜻이라
 * 솔로에서는 0번 하나뿐이어서 맞아떨어졌지만, 함께 하기에서는 사람이 앉은 자리가
 * 여럿이라 "(나)"가 둘씩 붙었다 — 화면에도 낭독에도 내가 누구인지가 사라진다.
 *
 * "나"는 이 화면 앞에 앉은 사람의 자리(localSeat) 하나뿐이다.
 */
export function memberLabel(game: Game, c: Combatant, gap = ' '): string {
  return c.seat === game.localSeat ? `${c.name}${gap}(나)` : c.name
}
