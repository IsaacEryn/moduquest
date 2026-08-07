import type { Game } from '../core/game'
import type { NetScheduler } from './netScheduler'
import type { Envelope } from './protocol'

/**
 * 확정 명령 하나를 게임에 적용한다. 모든 화면이 이 함수 하나로 같은 명령을
 * 같은 순서로 재생하므로, 코어가 결정적인 한 세계는 갈리지 않는다.
 *
 * 여기서는 검증하지 않는다 — 유효성은 코어의 가드(can*, 좌석·토큰 검사)가
 * 최종 책임지고, 무효한 명령은 모든 화면에서 똑같이 아무 일도 하지 않는다.
 *
 * **자리를 나르는 것은 여기서 반드시 해야 한다.** 코어의 가방·지갑을 만지는
 * 함수들은 자리를 생략하면 `localSeat`(그 화면의 주인)으로 떨어지는데, 그 값은
 * 화면마다 다르다. 한 번 빠뜨렸더니 게스트가 산 물건이 호스트의 지갑에서
 * 나가고 체크섬이 갈렸다 — 봉투가 자리를 나르는 이유가 그것이다.
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
      // 물약은 꺼낸 사람의 가방에서 나간다 — 자리마다 가방이 갈려 있다
      game.useItemInField(cmd.itemId, cmd.targetId, seat)
      break
    case 'equip':
      game.equip(cmd.memberId, cmd.itemId, seat)
      break
    case 'unequip':
      game.unequip(cmd.memberId, cmd.slot, seat)
      break
    case 'buy':
      game.buy(cmd.itemId, seat)
      break
    case 'sell':
      game.sell(cmd.itemId, seat)
      break
    case 'dismantle':
      game.dismantle(cmd.itemId, seat)
      break
    case 'upgrade':
      game.upgrade(cmd.memberId, cmd.stat, seat)
      break
    case 'setTrait':
      game.setTrait(cmd.traitId, seat)
      break
    case 'giveItem':
      game.giveItem(cmd.itemId, cmd.toSeat, seat)
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
