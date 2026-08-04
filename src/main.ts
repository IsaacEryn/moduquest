import './style.css'
import jobs from './data/jobs.json'
import monsters from './data/monsters.json'
import party from './data/party.json'
import stage from './data/stages/stage1.json'
import { EventBus } from './core/events'
import { Game } from './core/game'
import type { Dir, GameData, StageData } from './core/types'
import { createRenderer } from './render/scenes'
import { Announcer } from './ui/announcer'
import { BattleUI } from './ui/battleUI'
import { OptionsPanel } from './ui/options'
import { OptionsStore } from './ui/optionsStore'
import { Screens } from './ui/screens'

const data: GameData = {
  jobs: jobs as GameData['jobs'],
  monsters,
  party,
  stage: stage as StageData,
}

const bus = new EventBus()
const store = new OptionsStore(bus)
const game = new Game(data, bus, {
  schedule: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (handle) => window.clearTimeout(handle as number),
})
const options = new OptionsPanel(store)
const battleUI = new BattleUI(game, bus)
new Announcer(bus, store.options, (text) => battleUI.addLog(text))
const screens = new Screens(game, bus, battleUI, () => options.open())
createRenderer(game, bus, store.options)

// 물리 키(e.code) 기준 — 한글 IME 상태에서도 W/A/S/D·R이 동작해야 한다.
// e.key는 code가 비는 합성 이벤트를 위한 보조 경로.
const DIR_CODES: Record<string, Dir> = {
  ArrowUp: 'north',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  ArrowRight: 'east',
  KeyW: 'north',
  KeyS: 'south',
  KeyA: 'west',
  KeyD: 'east',
}

const DIR_KEYS: Record<string, Dir> = {
  ArrowUp: 'north',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  ArrowRight: 'east',
  w: 'north',
  s: 'south',
  a: 'west',
  d: 'east',
}

function isSummaryKey(e: KeyboardEvent): boolean {
  return e.code === 'KeyR' || e.key.toLowerCase() === 'r'
}

document.addEventListener('keydown', (e) => {
  if (options.isOpen) return

  if (e.key === 'Escape') {
    // 전투의 대상 선택 화면은 자체적으로 ESC를 처리(뒤로)하고 전파를 막는다
    options.open()
    return
  }

  if (game.mode === 'field') {
    const dir =
      DIR_CODES[e.code] ??
      DIR_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (dir) {
      e.preventDefault()
      game.moveField(dir)
      return
    }
    if (isSummaryKey(e)) game.fieldSummary()
  } else if (game.mode === 'battle') {
    if (isSummaryKey(e)) game.battleSummary()
  }
})

screens.showTitle()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
}
