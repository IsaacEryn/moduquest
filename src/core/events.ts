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
  | { type: 'downed'; target: Combatant }
  | { type: 'victory'; boss: boolean }
  | { type: 'defeat' }
  | { type: 'battleEnd' }
  | { type: 'battleSummary'; text: string }
  | { type: 'stageClear' }
  | { type: 'optionsChanged' }

export type GameMode = 'title' | 'dialogue' | 'field' | 'battle' | 'clear'

export type Listener = (e: GameEvent) => void

export class EventBus {
  private listeners: Listener[] = []

  on(fn: Listener): void {
    this.listeners.push(fn)
  }

  emit(e: GameEvent): void {
    for (const fn of this.listeners) fn(e)
  }
}
