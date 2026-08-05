import type { Game } from '../core/game'
import type { Dir, EquipSlot, PlayerAction, UpgradeStat } from '../core/types'
import type { PartySession } from './session'
import type { NetCommand, Seat } from './protocol'

/**
 * UI와 게임 사이의 문. 솔로에서는 있는 줄도 모르게 그대로 통과시키고(Reflect 1:1),
 * 함께 하기 중에만 변이 호출을 시퀀서 제안으로 우회시킨다.
 *
 * UI는 이 문의 존재를 모른다 — 솔로와 멀티에서 같은 코드가 같은 방식으로
 * game을 부른다. 반환값은 로컬 가드(can*)의 판정으로 답해 화면 갱신 관성을
 * 지키고, 실제 상태 변화는 확정 명령이 돌아와 일어난다(호스트는 그 자리에서,
 * 게스트는 한 박자 뒤에).
 */
export function createGamePort(game: Game, getSession: () => PartySession | null): Game {
  // 프로퍼티 접근마다 새 함수를 만들지 않도록 우회 함수를 한 번만 만든다
  const reroutes = new Map<PropertyKey, unknown>()

  const propose = (cmd: NetCommand) => getSession()?.propose(cmd)
  const mySeat = (): Seat => (getSession()?.mySeat ?? 0) as Seat

  reroutes.set('moveField', (dir: Dir) => {
    propose({ kind: 'move', dir })
  })
  reroutes.set('advanceDialogue', () => {
    propose({ kind: 'advanceDialogue' })
  })
  reroutes.set('playerAction', (action: PlayerAction) => {
    // 내 차례가 아니면 보내지 않는다 — 코어도 거절하지만 헛명령을 줄인다
    const actor = game.battle?.currentActor
    if (actor && actor.seat !== undefined && actor.seat !== mySeat()) return null
    propose({ kind: 'playerAction', action })
    return null
  })
  reroutes.set('useItemInField', (itemId: string, targetId: string) => {
    propose({ kind: 'useItemInField', itemId, targetId })
    return true
  })
  reroutes.set('equip', (memberId: string, itemId: string) => {
    const ok = game.canEquip(memberId, itemId).ok
    if (ok) propose({ kind: 'equip', memberId, itemId })
    return ok
  })
  reroutes.set('unequip', (memberId: string, slot: EquipSlot) => {
    propose({ kind: 'unequip', memberId, slot })
    return true
  })
  reroutes.set('buy', (itemId: string) => {
    const ok = game.canBuy(itemId).ok
    if (ok) propose({ kind: 'buy', itemId })
    return ok
  })
  reroutes.set('sell', (itemId: string) => {
    const ok = game.canSell(itemId).ok
    if (ok) propose({ kind: 'sell', itemId })
    return ok
  })
  reroutes.set('dismantle', (itemId: string) => {
    const ok = game.canDismantle(itemId).ok
    if (ok) propose({ kind: 'dismantle', itemId })
    return ok
  })
  reroutes.set('upgrade', (memberId: string, stat: UpgradeStat) => {
    const ok = game.canUpgrade(memberId, stat).ok
    if (ok) propose({ kind: 'upgrade', memberId, stat })
    return ok
  })
  reroutes.set('setTrait', (traitId: string) => {
    const session = getSession()
    if (!session?.isHost) return false // 특성은 방장(0번 자리)의 것
    const ok = game.canChangeTrait().ok
    if (ok) propose({ kind: 'setTrait', traitId })
    return ok
  })
  reroutes.set('startStage', (index: number) => {
    if (getSession()?.isHost) propose({ kind: 'startStage', index })
  })
  reroutes.set('nextStage', () => {
    if (getSession()?.isHost) propose({ kind: 'nextStage' })
  })
  reroutes.set('restartStage', () => {
    if (getSession()?.isHost) propose({ kind: 'restartStage' })
  })
  reroutes.set('passMoveToken', (toSeat: number) => {
    const s = getSession()
    if (!s) return false
    const from = s.isHost ? 0 : s.mySeat
    if (from !== game.moveTokenSeat && from !== 0) return false
    propose({ kind: 'token', toSeat: toSeat as Seat })
    return true
  })
  // 함께 하기 중에는 게임을 멈출 수 없다 — 옵션 창이 열려도 세계는 흐른다.
  // 락스텝은 모두의 시간이라 한 사람이 멈추면 전원이 멈추기 때문이다
  reroutes.set('pause', () => {})
  reroutes.set('resume', () => {})

  return new Proxy(game, {
    get(target, prop, receiver) {
      const session = getSession()
      if (session && session.started && reroutes.has(prop)) {
        return reroutes.get(prop)
      }
      const value = Reflect.get(target, prop, receiver)
      // 메서드의 this가 프록시가 아니라 실제 게임을 가리켜야 한다 —
      // 내부 호출(this.stepBattle 등)까지 우회되면 이중 제안이 된다
      if (typeof value === 'function') return value.bind(target)
      return value
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value)
    },
  }) as Game
}
