import type { Combatant, DialogueLine, Dir, Pos } from './types'

export type GameEvent =
  | { type: 'mode'; mode: GameMode }
  | { type: 'moved'; dir: Dir; pos: Pos; ahead: string | null }
  | { type: 'blocked'; dir: Dir }
  | { type: 'fieldSummary'; text: string }
  | { type: 'checkpoint' }
  | { type: 'dialogue'; line: DialogueLine; last: boolean }
  | { type: 'battleStart'; enemies: Combatant[]; order: Combatant[] }
  | { type: 'turnStart'; actor: Combatant }
  | { type: 'playerTurn' }
  | { type: 'attacked'; actor: Combatant; target: Combatant; damage: number }
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
  | { type: 'stageStart'; index: number; total: number; title: string; objective: string }
  | { type: 'stageClear'; index: number; total: number; hasNext: boolean }
  | { type: 'optionsChanged' }

export type GameMode = 'title' | 'dialogue' | 'field' | 'battle' | 'clear'

export type Listener = (e: GameEvent) => void

export class EventBus {
  private listeners: Listener[] = []

  on(fn: Listener): void {
    this.listeners.push(fn)
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
