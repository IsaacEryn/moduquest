import './style.css'
import jobs from './data/jobs.json'
import monsters from './data/monsters.json'
import stage from './data/stages/stage1.json'
import { EventBus } from './core/events'
import { Game } from './core/game'
import type { Dir, GameData, StageData } from './core/types'
import { createRenderer } from './render/scenes'
import { Announcer } from './ui/announcer'
import { BattleUI } from './ui/battleUI'
import { OptionsPanel } from './ui/options'
import { Screens } from './ui/screens'

const data: GameData = {
  jobs,
  monsters,
  stage: stage as StageData,
}

const bus = new EventBus()
const game = new Game(data, bus)
const options = new OptionsPanel(game)
const battleUI = new BattleUI(game, bus)
new Announcer(bus, game.options, (text) => battleUI.addLog(text))
const screens = new Screens(game, bus, battleUI, () => options.open())
createRenderer(game, bus)

const DIR_KEYS: Record<string, Dir> = {
  ArrowUp: 'north',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  ArrowRight: 'east',
  // 일부 브라우저·입력기가 쓰는 구식 키 이름
  Up: 'north',
  Down: 'south',
  Left: 'west',
  Right: 'east',
  w: 'north',
  s: 'south',
  a: 'west',
  d: 'east',
}

document.addEventListener('keydown', (e) => {
  if (options.isOpen) return

  if (e.key === 'Escape') {
    // 전투의 대상 선택 화면은 자체적으로 ESC를 처리(뒤로)하고 전파를 막는다
    options.open()
    return
  }

  if (game.mode === 'field') {
    const dir = DIR_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (dir) {
      e.preventDefault()
      game.moveField(dir)
      return
    }
    if (e.key.toLowerCase() === 'r') game.fieldSummary()
  } else if (game.mode === 'battle') {
    if (e.key.toLowerCase() === 'r') game.battleSummary()
  }
})

screens.showTitle()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
}
