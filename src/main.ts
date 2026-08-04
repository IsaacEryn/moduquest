import './style.css'
import jobs from './data/jobs.json'
import monsters from './data/monsters.json'
import party from './data/party.json'
import stage1 from './data/stages/stage1.json'
import stage2 from './data/stages/stage2.json'
import stage3 from './data/stages/stage3.json'
import traits from './data/traits.json'
import { Sfx } from './audio/sfx'
import { EventBus } from './core/events'
import { Game } from './core/game'
import type { Dir, GameData, StageData } from './core/types'
import { createRenderer } from './render/scenes'
import { Announcer } from './ui/announcer'
import { BattleUI } from './ui/battleUI'
import { OptionsPanel } from './ui/options'
import { OptionsStore } from './ui/optionsStore'
import { LocalSaveRepository } from './save/saveRepository'
import { Screens } from './ui/screens'
import { SlotPanel } from './ui/slotPanel'
import { StageSelect } from './ui/stageSelect'
import { TextLog } from './ui/textLog'
import { TraitPanel } from './ui/traitPanel'
import { TraitStore } from './ui/traitStore'

const data: GameData = {
  jobs: jobs as GameData['jobs'],
  monsters,
  party,
  // 배열 순서가 진행 순서다
  stages: [stage1, stage2, stage3] as StageData[],
  traits: traits as GameData['traits'],
}

const bus = new EventBus()
const store = new OptionsStore(bus)
const traitStore = new TraitStore()
const game = new Game(
  data,
  bus,
  {
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
  },
  traitStore.get(),
  () => Date.now(),
)
// 옵션·특성 화면이 열려 있는 동안은 게임도 멈춘다 — "언제든 멈출 수 있다"
const pauseHooks = { onOpen: () => game.pause(), onClose: () => game.resume() }
const options = new OptionsPanel(store, pauseHooks)
const traitPanel = new TraitPanel(game, traitStore, pauseHooks)
const battleUI = new BattleUI(game, bus, () => options.open())

// 낭독과 같은 문장이 텍스트 기록 창에도 쌓인다 — 글만으로 게임을 따라가는 렌즈
const textLog = new TextLog()
textLog.setVisible(store.options.textLog)
const announcer = new Announcer(bus, store.options, (text) => textLog.add(text))

const saves = new LocalSaveRepository(data)
/** 지금 쓰고 있는 자리. 새로 시작하거나 이어서 할 때 정해진다 */
let activeSlot: number | null = null
const slotPanel = new SlotPanel(game, saves, {
  ...pauseHooks,
  announce: (text) => announcer.polite(text),
  onStart: (slot) => {
    activeSlot = slot
    game.start()
  },
  onContinue: async (slot) => {
    const snapshot = await saves.load(slot)
    if (!snapshot) return
    activeSlot = slot
    game.restore(snapshot)
  },
})
const stageSelect = new StageSelect(game, {
  ...pauseHooks,
  onPick: (index) => game.startStage(index),
})
const screens = new Screens(
  game,
  bus,
  battleUI,
  () => options.open(),
  () => traitPanel.open(),
  (mode) => void slotPanel.open(mode),
  () => stageSelect.open(),
)

/**
 * 필드에서 상황이 바뀔 때마다 지금 자리에 저장한다 — 저장 버튼을 따로 두지 않는다.
 * 걸어간 위치까지 남겨야 "이어서 하기"가 실제로 이어진다.
 */
const AUTOSAVE_ON = new Set(['moved', 'checkpoint', 'mode', 'traitChanged'])
bus.on((e) => {
  if (!AUTOSAVE_ON.has(e.type)) return
  if (activeSlot === null || !game.canSave) return
  void saves.save(activeSlot, game.snapshot())
})

/** 타이틀로 돌아올 때마다 "이어서 하기"를 보일지 다시 판단한다 */
bus.on((e) => {
  if (e.type !== 'mode' || e.mode !== 'title') return
  void slotPanel.hasAny().then((has) => {
    screens.hasSaves = has
    screens.showTitle()
  })
})
createRenderer(game, bus, store.options)
// 같은 사건을 소리로도 — 방향이 있는 소리는 공간 음향으로 배치한다
new Sfx(bus, store.options)

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
  // 글자를 입력하는 중이면 게임 조작으로 가로채지 않는다.
  // 없으면 이메일 칸에 'sad'를 치는 순간 캐릭터가 남·서·동으로 움직인다
  const t = e.target
  if (
    t instanceof HTMLElement &&
    (t.isContentEditable ||
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT')
  ) {
    return
  }
  // 열린 대화상자가 있으면 게임 키를 처리하지 않는다.
  // 패널마다 플래그를 늘리는 대신 한 줄로 — 앞으로 대화상자가 늘어도 그대로 동작한다
  if (document.querySelector('dialog[open]')) return

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

// 저장된 기록이 있는지 먼저 확인하고 타이틀을 그린다
void slotPanel.hasAny().then((has) => {
  screens.hasSaves = has
  screens.showTitle()
})

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
}
