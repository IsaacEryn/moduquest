import type { Combatant, DialogueLine, Dir, EquipSlot, Pos } from './types'

export type GameEvent =
  | { type: 'mode'; mode: GameMode }
  | { type: 'moved'; dir: Dir; pos: Pos; ahead: string | null }
  | { type: 'blocked'; dir: Dir }
  | { type: 'fieldSummary'; text: string }
  | { type: 'checkpoint' }
  | { type: 'dialogue'; line: DialogueLine; last: boolean }
  | { type: 'battleStart'; enemies: Combatant[]; order: Combatant[] }
  | { type: 'turnStart'; actor: Combatant }
  | { type: 'playerTurn'; actor: Combatant }
  // 함께 하기 — 자리의 조작자가 바뀌었다(합류·이탈·대행)
  | { type: 'seatControlChanged'; seat: number; controller: 'human' | 'npc'; memberName: string }
  // 함께 하기 — 길잡이(이동 토큰)가 다른 자리로 넘어갔다
  | { type: 'moveTokenChanged'; seat: number; memberName: string }
  | { type: 'attacked'; actor: Combatant; target: Combatant; damage: number; skillName?: string }
  | { type: 'healed'; actor: Combatant; target: Combatant; amount: number }
  | { type: 'taunted'; actor: Combatant; duration: number }
  | { type: 'defended'; actor: Combatant }
  | { type: 'deflected'; actor: Combatant; target: Combatant }
  | { type: 'traitChanged'; name: string; description: string }
  | { type: 'downed'; target: Combatant }
  | { type: 'victory'; boss: boolean; revived: Combatant[] }
  | { type: 'defeat' }
  | { type: 'battleEnd' }
  | { type: 'battleSummary'; text: string }
  | { type: 'manaSpent'; actor: Combatant; cost: number; left: number }
  | {
      type: 'equipChanged'
      memberName: string
      memberId: string
      isPlayer: boolean
      slot: EquipSlot
      /** 새로 입은 것. null이면 벗기만 했다 */
      itemName: string | null
      /** 이 슬롯에서 빠져 가방으로 돌아간 것 */
      removedName: string | null
    }
  | { type: 'itemGained'; names: string[] }
  | { type: 'chestOpened'; itemNames: string[] }
  | {
      type: 'itemUsed'
      name: string
      target: Combatant
      /** 실제 적용량 — 0이면 그 효과는 없었던 것 */
      healed: number
      mana: number
      cooldownCut: number
    }
  | { type: 'xpGained'; amount: number; total: number; toNext: number | null }
  | { type: 'levelUp'; level: number; unlocked: { jobName: string; skillName: string }[] }
  | {
      type: 'areaChanged'
      areaId: string
      areaName: string
      /** 스테이지 안 몇 번째 구역인가 */
      index: number
      total: number
      /** 어느 문으로 들어왔나. null이면 스테이지 시작이나 부활 */
      fromExitName: string | null
      reason: 'start' | 'exit' | 'respawn'
    }
  // 마을 경제 — name은 데이터에서 온 이름이라 저장에는 들어가지 않는다
  | { type: 'goldGained'; amount: number; total: number }
  | { type: 'bought'; name: string; price: number; gold: number }
  | { type: 'sold'; name: string; price: number; gold: number }
  | { type: 'dismantled'; name: string; gained: number; materials: number }
  | {
      type: 'upgraded'
      memberName: string
      statName: string
      level: number
      /** 이번에 오른 양 */
      gain: number
      gold: number
      materials: number
    }
  | { type: 'stageStart'; index: number; total: number; title: string; objective: string }
  | { type: 'stageClear'; index: number; total: number; hasNext: boolean }
  | { type: 'optionsChanged' }
  /** 로그인이 방금 끝났다 — 소리와 자막이 짝으로 알린다 */
  | { type: 'signedIn' }

export type GameMode = 'title' | 'dialogue' | 'field' | 'battle' | 'clear'

export type Listener = (e: GameEvent) => void

export class EventBus {
  private listeners: Listener[] = []

  /** 구독한다. 돌려받는 함수를 부르면 구독이 끊긴다 — 수명이 있는 구독자를 위해 */
  on(fn: Listener): () => void {
    this.listeners.push(fn)
    return () => this.off(fn)
  }

  off(fn: Listener): void {
    const i = this.listeners.indexOf(fn)
    if (i >= 0) this.listeners.splice(i, 1)
  }

  /** 구독자 수 — 수명이 있는 구독자가 실제로 반납했는지 시험이 본다 */
  get listenerCount(): number {
    return this.listeners.length
  }

  emit(e: GameEvent): void {
    // 리스너 하나가 죽어도 나머지는 이벤트를 받아야 한다
    for (const fn of this.listeners) {
      try {
        fn(e)
      } catch (err) {
        console.error('이벤트 리스너 오류:', e.type, err)
      }
    }
  }
}
