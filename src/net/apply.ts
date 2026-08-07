import type { Game } from '../core/game'
import type { NetScheduler } from './netScheduler'
import type { Envelope } from './protocol'

/**
 * 확정 명령 하나를 게임에 적용한다. 모든 화면이 이 함수 하나로 같은 명령을
 * 같은 순서로 재생하므로, 코어가 결정적인 한 세계는 갈리지 않는다.
 *
 * 여기서는 검증하지 않는다 — 유효성은 코어의 가드(can*, 좌석·토큰 검사)가
 * 최종 책임지고, 무효한 명령은 모든 화면에서 똑같이 아무 일도 하지 않는다.
 */
export function applyEnvelope(
  game: Game,
  scheduler: NetScheduler,
  env: Envelope,
  onEndSession: () => void,
): void {
  const { seat, cmd } = env
  switch (cmd.kind) {
    case 'move':
      game.moveField(cmd.dir, seat)
      break
    case 'advanceDialogue':
      game.advanceDialogue(seat)
      break
    case 'playerAction':
      game.playerAction(cmd.action, seat)
      break
    case 'useItemInField':
      // 가방은 파티의 것 — 누가 물약을 꺼내도 된다
      game.useItemInField(cmd.itemId, cmd.targetId)
      break
    case 'equip':
      game.equip(cmd.memberId, cmd.itemId)
      break
    case 'unequip':
      game.unequip(cmd.memberId, cmd.slot)
      break
    case 'buy':
      game.buy(cmd.itemId)
      break
    case 'sell':
      game.sell(cmd.itemId)
      break
    case 'dismantle':
      game.dismantle(cmd.itemId)
      break
    case 'upgrade':
      game.upgrade(cmd.memberId, cmd.stat)
      break
    case 'setTrait':
      game.setTrait(cmd.traitId, seat)
      break
    case 'startStage':
      game.startStage(cmd.index)
      break
    case 'nextStage':
      game.nextStage()
      break
    case 'restartStage':
      game.restartStage()
      break
    case 'token':
      game.passMoveToken(cmd.toSeat, seat)
      break
    case 'seatControl':
      game.setSeatController(cmd.seat, cmd.controller)
      break
    case 'tick':
      scheduler.runTick()
      break
    case 'endSession':
      onEndSession()
      break
  }
}
