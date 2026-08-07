import './style.css'
import economy from './data/economy.json'
import itemsData from './data/items.json'
import setsData from './data/sets.json'
import jobs from './data/jobs.json'
import monsters from './data/monsters.json'
import party from './data/party.json'
import progression from './data/progression.json'
import stage1 from './data/stages/stage1.json'
import stage2 from './data/stages/stage2.json'
import stage3 from './data/stages/stage3.json'
import traits from './data/traits.json'
import { Music } from './audio/music'
import { Sfx } from './audio/sfx'
import { EventBus } from './core/events'
import { Game, type TurnScheduler } from './core/game'
import type { Dir, GameData, StageData } from './core/types'
import { createGamePort } from './net/gamePort'
import type { PartySession, SessionHooks } from './net/session'
import type { CoopPanel } from './ui/coopPanel'
import { createRenderer } from './render/scenes'
import { Announcer, josa } from './ui/announcer'
import { BagPanel } from './ui/bagPanel'
import { BattleUI } from './ui/battleUI'
import { FieldHud } from './ui/fieldHud'
import { HelpPanel } from './ui/helpPanel'
import { OptionsPanel } from './ui/options'
import { OptionsStore } from './ui/optionsStore'
import { PartyPanel } from './ui/partyPanel'
import { AUTOSAVE_ON } from './save/autosaveEvents'
import { LocalSaveRepository, SwitchableSaveRepository } from './save/saveRepository'
import { Screens } from './ui/screens'
import { SlotPanel } from './ui/slotPanel'
import { StageSelect } from './ui/stageSelect'
import { StatusPanel } from './ui/statusPanel'
import { attachSwipe } from './ui/swipe'
import { TextLog } from './ui/textLog'
import { Toasts } from './ui/toasts'
import { TownPanel } from './ui/townPanel'
import { TraitPanel } from './ui/traitPanel'
import { TraitStore } from './ui/traitStore'

const data: GameData = {
  jobs: jobs as GameData['jobs'],
  monsters: monsters as GameData['monsters'],
  party,
  progression,
  // 배열 순서가 진행 순서다
  stages: [stage1, stage2, stage3] as StageData[],
  traits: traits as GameData['traits'],
  items: itemsData as GameData['items'],
  sets: setsData as GameData['sets'],
  economy: economy as GameData['economy'],
}

/** 지금 쓰고 있는 자리. 새로 시작하거나 이어서 할 때 정해진다 */
let activeSlot: number | null = null

/** 함께 하기 세션. 없으면 모든 것이 지금까지의 솔로 그대로다 */
let activeSession: PartySession | null = null
/** 게스트가 출발 조건으로 받은 지도 순환 번호 — 세션 중에만 값이 있다 */
let sessionLayoutKey: number | null = null

const bus = new EventBus()
const store = new OptionsStore(bus)
const traitStore = new TraitStore()

// 턴 타이머의 시계. 함께 하기가 시작되면 네트워크 시계로 갈아끼운다 —
// 겉모습은 같아서 게임 코어는 무엇이 꽂혀 있는지 모른다
const realScheduler: TurnScheduler = {
  schedule: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (handle) => window.clearTimeout(handle as number),
}
const swappable = {
  inner: realScheduler,
  schedule: (fn: () => void, ms: number) => swappable.inner.schedule(fn, ms),
  cancel: (handle: unknown) => swappable.inner.cancel(handle),
}

const game = new Game(
  data,
  bus,
  swappable,
  traitStore.get(),
  () => Date.now(),
  // 지도 순환의 자리 번호 — 자리마다 다른 지도로 시작한다.
  // 함께 하기 중에는 방장이 알려준 번호가 우선이다
  () => sessionLayoutKey ?? activeSlot ?? 0,
)

// UI가 잡는 게임 손잡이. 솔로에서는 게임 그 자체이고,
// 함께 하기 중에는 변이 호출만 시퀀서 제안으로 우회된다
const port = createGamePort(game, () => activeSession)

// 옵션·특성 화면이 열려 있는 동안은 게임도 멈춘다 — "언제든 멈출 수 있다".
// 함께 하기 중에는 port가 멈춤을 무시한다 — 락스텝은 모두의 시간이다
const pauseHooks = { onOpen: () => port.pause(), onClose: () => port.resume() }
const options = new OptionsPanel(store, {
  ...pauseHooks,
  // 타이틀에서는 나갈 곳이 없다
  canExit: () => game.mode !== 'title',
  onExit: () => {
    // 함께 하기 중의 "타이틀로"는 모험단을 떠나는 일이다 —
    // 방장은 전원을 매듭짓고, 동료는 혼자 조용히 나온다
    if (activeSession) {
      if (activeSession.isHost) activeSession.finish()
      else activeSession.leave()
      return
    }
    game.returnToTitle()
  },
  announce: (text) => announcer.polite(text),
})
const traitPanel = new TraitPanel(port, traitStore, pauseHooks)
const battleUI = new BattleUI(port, bus, () => options.open())

// 낭독과 같은 문장이 텍스트 기록 창에도 쌓인다 — 글만으로 게임을 따라가는 렌즈
const textLog = new TextLog()
textLog.setVisible(store.options.textLog)
const announcer = new Announcer(
  bus,
  store.options,
  (text) => textLog.add(text),
  // "나"의 기준 — 함께 하기에서는 내 좌석의 파티원, 솔로에서는 0번
  () => game.party[game.localSeat]?.id ?? null,
  () => game.localSeat,
)

// 저장이 막히면 반드시 알린다 — 저장 버튼이 없는 게임이라 조용한 실패가 곧 손실이다
const saveFailed = (reason: string) => announcer.assertive(reason)
const deviceSaves = new LocalSaveRepository(data, saveFailed)

/**
 * 지금 쓰는 저장 자리. 싱글 플레이는 이 기기에, 멀티 플레이는 계정에 남는다 —
 * 두 벌은 서로 다른 기록이고 섞이지 않는다. 화면들은 이 껍데기만 붙잡으므로
 * 문이 바뀔 때 안쪽만 갈아 끼우면 된다.
 */
const saves = new SwitchableSaveRepository(deviceSaves)

/** 이 기기의 자리로 되돌린다 — 싱글 플레이로 들어가거나 로그아웃할 때 */
function useDeviceSaves(): void {
  if (saves.inner === deviceSaves) return
  saves.inner = deviceSaves
  activeSlot = null // 다른 벌의 자리 번호를 물려받지 않는다
}

/** 계정의 자리로 옮긴다. 클라우드 저장소는 서버 코드를 끌고 오므로 그때 불러온다 */
async function useAccountSaves(userId: string): Promise<void> {
  const { CloudSaveRepository } = await import('./save/cloudSaveRepository')
  saves.inner = new CloudSaveRepository(userId, data, saveFailed)
  activeSlot = null
}
const partyPanel = new PartyPanel(game, {
  ...pauseHooks,
  onConfirm: (jobs) => {
    const names = jobs.map((j) => data.jobs[j]?.name ?? j)
    // 함께 하기 중이면 출발 조건만 나눈다 — 전원이 같은 조건에서 함께 시작한다
    if (activeSession && !activeSession.started) {
      announcer.polite(`파티를 정했다. ${names.join(', ')} — 함께 출발한다.`)
      activeSession.startNew(jobs)
      return
    }
    game.setParty(jobs)
    announcer.polite(`파티를 정했다. 나는 ${names[0]}, 동료는 ${names[1]}와 ${names[2]}.`)
    game.start()
  },
})
const slotPanel = new SlotPanel(game, saves, {
  ...pauseHooks,
  announce: (text) => announcer.polite(text),
  onStart: (slot) => {
    activeSlot = slot
    // 자리를 골랐으면 파티부터 짠다 — 확정하면 모험이 시작된다.
    // 멀티 플레이는 같은 직업 겹침을 허용한다 — 셋 다 힐러여도 그들의 모험이다.
    // 자리마다 누가 앉는지도 함께 넘긴다 — 사람 몫인지 컴퓨터 몫인지 알고 골라야 한다
    const session = activeSession
    partyPanel.open({
      allowDuplicates: session !== null,
      seatOwners: session
        ? [0, 1, 2].map((n) => session.seats.find((s) => s.seat === n)?.nickname ?? null)
        : undefined,
    })
  },
  onContinue: async (slot) => {
    const snapshot = await saves.load(slot)
    if (!snapshot) return
    activeSlot = slot
    if (activeSession && !activeSession.started) {
      activeSession.startRestore(snapshot)
      return
    }
    game.restore(snapshot)
  },
})
const stageSelect = new StageSelect(game, {
  ...pauseHooks,
  onPick: (index) => port.startStage(index),
})
const bagPanel = new BagPanel(port, pauseHooks, () => store.options.lowStim)
const helpPanel = new HelpPanel(data, pauseHooks)
const statusPanel = new StatusPanel(port, pauseHooks, () => store.options.lowStim)
const townPanel = new TownPanel(port, pauseHooks, () => store.options.lowStim)
// 필드 상단 상시 현황 — 창을 열지 않아도 체력과 지갑이 보인다
const fieldHud = new FieldHud(game, bus)
// 획득·레벨업 토스트 — 시각 전용, 낭독은 Announcer가 이미 한다
new Toasts(bus)
const screens = new Screens(
  port,
  bus,
  battleUI,
  () => options.open(),
  () => traitPanel.open(),
  () => void openSinglePlay(),
  () => stageSelect.open(),
  () => bagPanel.open(),
  () => helpPanel.open(),
  () => statusPanel.open(),
  () => townPanel.open(),
  fieldHud,
  () => store.options.lowStim,
  () => void openCoop(),
)

// --- 함께 하기 — 문을 두드릴 때에만 코드를 불러온다. 솔로는 서버로 요청 0건 ---

let coopPanel: CoopPanel | null = null

const sessionHooks: SessionHooks = {
  announce: (t) => announcer.polite(t),
  alert: (t) => announcer.assertive(t),
  onRosterChanged: () => coopPanel?.refreshRoster(),
  onStarted: () => coopPanel?.onStarted(),
  onEnded: (reason) => {
    activeSession = null
    sessionLayoutKey = null
    // 좌석과 시점을 솔로 기준으로 되돌린다 — 다음 판이 혼자여도 어색함이 없다
    game.setSeatController(1, 'npc')
    game.setSeatController(2, 'npc')
    game.localSeat = 0
    game.moveTokenSeat = 0
    if (game.mode !== 'title') game.returnToTitle()
    game.setTrait(traitStore.get() ?? '')
    announcer.polite(reason)
  },
  setLayoutKey: (key) => {
    sessionLayoutKey = key
  },
  getLayoutKey: () => activeSlot ?? 0,
  installScheduler: (s) => {
    swappable.inner = s
  },
  restoreScheduler: () => {
    swappable.inner = realScheduler
  },
}

/**
 * 싱글 플레이 — 이 기기의 자리로 되돌리고 저장 자리를 연다.
 * 로그인한 채로도 싱글은 기기에 남는다. 두 벌은 서로 다른 기록이다.
 */
async function openSinglePlay(): Promise<void> {
  // 로비에 두고 온 모험단이 있으면 먼저 떠난다. 출발을 취소하고 타이틀로
  // 돌아와도 채널은 살아 있어서, 혼자 하겠다고 들어온 판이 여전히 모험단의
  // 규칙(자리·명령 중계)을 따랐다 — 파티 짜기가 남의 자리를 물어보고,
  // 로비에 남은 동료는 오지 않을 출발을 기다린다
  if (activeSession && !activeSession.started) activeSession.leave()
  useDeviceSaves()
  await slotPanel.open(
    '이 기기에 남는 기록이다. 기록이 있는 자리는 이어서 하고, 빈 자리는 새로 시작한다.',
  )
}

async function openCoop(): Promise<void> {
  if (!coopPanel) {
    const [{ CoopPanel }, { PartySession }] = await Promise.all([
      import('./ui/coopPanel'),
      import('./net/session'),
    ])
    coopPanel = new CoopPanel({
      ...pauseHooks,
      announce: (t) => announcer.polite(t),
      // 멀티 플레이의 기록은 계정에 붙는다 — 누가 로그인해 있느냐가 곧 어느 자리냐다
      onProfileChanged: (profile) => {
        if (profile) void useAccountSaves(profile.userId)
        else useDeviceSaves()
      },
      createSession: async (me) => {
        activeSession = await PartySession.host(game, data, bus, sessionHooks, me)
        return activeSession
      },
      joinSession: async (code, me) => {
        activeSession = await PartySession.join(code, game, data, bus, sessionHooks, me)
        return activeSession
      },
      currentSession: () => activeSession,
      // 창을 겹쳐 열지 않는다 — 선물함과 같은 규칙이다. 겹치면 배경이 두 겹으로
      // 어두워지고 어디로 돌아가는지가 화면으로도 낭독으로도 흐려진다
      hostStart: () => {
        void (async () => {
          coopPanel?.close()
          await slotPanel.open(
            '계정에 남는 기록이다. 자리를 고르면 모험단이 함께 출발한다.',
            // 고르지 않고 닫았으면 로비로 돌려보낸다 — 어디서 왔는지를 잃지 않는다
            () => void openCoop(),
          )
        })()
      },
      setGuestSlot: (slot) => {
        activeSlot = slot
      },
      describeSlots: async () => {
        const slots = await saves.list()
        return slots.map((s) => ({
          empty: s.empty,
          label: s.empty
            ? `${s.slot + 1}번 자리 — 비어 있다`
            : `${s.slot + 1}번 자리 — 기록이 있다 (덮어쓰며 저장된다)`,
        }))
      },
      openGifts: (me) => {
        void (async () => {
          const { GiftPanel } = await import('./ui/giftPanel')
          const panel = new GiftPanel(data, saves, {
            announce: (t) => announcer.polite(t),
            myFriendCode: () => me.friendCode,
            // 선물함을 닫으면 함께 하기 화면으로 돌아온다 — 어디서 왔는지를 잃지 않는다
            onClose: () => void openCoop(),
          })
          // 창을 겹쳐 열지 않는다 — 배경이 두 겹으로 어두워지고, 어디로 돌아가는지가
          // 화면으로도 낭독으로도 흐려진다
          coopPanel?.close()
          await panel.open()
        })()
      },
      openFriends: (me) => {
        void (async () => {
          const [{ FriendPanel }, { sendPartyInvite }] = await Promise.all([
            import('./ui/friendPanel'),
            import('./net/friends'),
          ])
          const panel = new FriendPanel({
            announce: (t) => announcer.polite(t),
            myFriendCode: () => me.friendCode,
            // 지금 모험단이 있어야 친구를 부를 수 있다 — 부를 곳이 없으면 초대도 없다
            partyCode: () => activeSession?.code ?? null,
            invite: async (userId, nickname) => {
              const code = activeSession?.code
              if (!code) return
              await sendPartyInvite(userId, code)
              announcer.polite(`${josa(nickname, '을', '를')} 모험단으로 불렀다.`)
            },
            onClose: () => void openCoop(),
          })
          coopPanel?.close()
          await panel.open()
        })()
      },
    })
  }
  await coopPanel.open()
}

/**
 * 필드에서 상황이 바뀔 때마다 지금 자리에 저장한다 — 저장 버튼을 따로 두지 않는다.
 * 걸어간 위치까지 남겨야 "이어서 하기"가 실제로 이어진다.
 */
bus.on((e) => {
  if (!AUTOSAVE_ON.has(e.type)) return
  if (activeSlot === null || !game.canSave) return
  void saves.save(activeSlot, game.snapshot())
})

// 화면 모드를 body에 남긴다 — 타이틀·클리어에서 지도를 숨기는 CSS가 이 값을 본다
bus.on((e) => {
  if (e.type === 'mode') document.body.dataset.mode = e.mode
})

// 함께 하기 중에는 동료의 거래·장비·물약이 내 열린 창에도 닿아야 한다 —
// 솔로에서는 내 손이 곧 갱신이라 이 길이 필요 없다
bus.on((e) => {
  if (!activeSession) return
  if (
    e.type === 'bought' ||
    e.type === 'sold' ||
    e.type === 'dismantled' ||
    e.type === 'upgraded' ||
    e.type === 'equipChanged' ||
    e.type === 'itemUsed' ||
    e.type === 'itemGained' ||
    e.type === 'goldGained'
  ) {
    townPanel.refresh()
    statusPanel.refresh()
    bagPanel.refresh()
  }
})

// 타이틀은 저장 유무와 무관하게 늘 같은 모양이다 — 문은 언제나 둘이다.
// 예전에는 "이어서 하기"가 나타났다 사라지며 버튼 수와 첫 포커스가 함께 바뀌었다
// 지나온 길 표시는 옵션이 정하고 그림·글 두 렌즈가 함께 따른다
const applyTrail = () => { game.field.showTrail = store.options.trail }
applyTrail()
bus.on((e) => {
  if (e.type === 'optionsChanged' || e.type === 'areaChanged' || e.type === 'stageStart') {
    applyTrail()
  }
})
createRenderer(game, bus, store.options)
// 같은 사건을 소리로도 — 방향이 있는 소리는 공간 음향으로 배치한다
new Sfx(bus, store.options)
// 배경음악도 합성이다 — 스테이지마다 다른 곡이 같은 자리에서 언제나 같게 흐른다
const music = new Music(bus, store.options)

// 손가락으로 쓸어도 움직인다 — 지도 위에서 가고 싶은 쪽으로 밀면 된다.
// 방향 버튼과 키보드는 그대로다. 조작 수단을 바꾸는 게 아니라 하나 더 놓는 것이다
const gameArea = document.querySelector<HTMLElement>('#game')
if (gameArea) {
  attachSwipe(gameArea, {
    canMove: () => game.mode === 'field' && !document.querySelector('dialog[open]'),
    onSwipe: (dir) => port.moveField(dir),
  })
}

// 물리 키(e.code) 기준 — 한글 IME 상태에서도 W/A/S/D·R이 동작해야 한다.
// e.key는 code가 비는 합성 이벤트를 위한 보조 경로.
const ARROW_CODES: Record<string, Dir> = {
  ArrowUp: 'north',
  ArrowDown: 'south',
  ArrowLeft: 'west',
  ArrowRight: 'east',
}

const ARROW_KEYS: Record<string, Dir> = { ...ARROW_CODES }

const LETTER_CODES: Record<string, Dir> = {
  KeyW: 'north',
  KeyS: 'south',
  KeyA: 'west',
  KeyD: 'east',
}

const LETTER_KEYS: Record<string, Dir> = {
  w: 'north',
  s: 'south',
  a: 'west',
  d: 'east',
}

/**
 * 글자 하나짜리 단축키는 옵션에서 끌 수 있다(WCAG 2.1.4). 화살표 키와 화면의
 * 방향 버튼은 이 설정과 무관하게 언제나 동작하므로 꺼도 잃는 조작이 없다 —
 * 음성 입력으로 말하다가 캐릭터가 움직이는 일을 막기 위한 문이다.
 */
function letterKeysOn(): boolean {
  return store.options.letterKeys
}

function isSummaryKey(e: KeyboardEvent): boolean {
  if (!letterKeysOn()) return false
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
    // 화살표는 글자 키가 아니므로 언제나 산다. W·A·S·D만 옵션을 따른다
    const arrow = ARROW_CODES[e.code] ?? ARROW_KEYS[e.key]
    const dir =
      arrow ??
      (letterKeysOn()
        ? (LETTER_CODES[e.code] ?? LETTER_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key])
        : undefined)
    if (dir) {
      e.preventDefault()
      port.moveField(dir)
      return
    }
    if (isSummaryKey(e)) game.fieldSummary()
  } else if (game.mode === 'battle') {
    if (isSummaryKey(e)) game.battleSummary()
  }
})

// 첫 화면은 mode 이벤트 없이 그려지므로 초기값을 직접 남긴다
document.body.dataset.mode = game.mode

screens.showTitle()

/**
 * 운영 페이지 진입 링크 — 관리자에게만, 타이틀에서만 보인다.
 * localStorage에 운영 페이지 방문 흔적과 로그인 흔적이 둘 다 있을 때만
 * 확인을 시작한다. 흔적이 없으면 여기서 끝 — 서버 요청 0건, 코드 로드도 없다.
 */
if (
  localStorage.getItem('moduquest-admin-path') !== null &&
  Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
) {
  void import('./net/adminLink').then((m) => m.attachAdminLink())
}

/**
 * 확인 메일의 링크를 눌러 돌아온 참이면 함께 하기를 바로 연다.
 *
 * 서버 코드는 함께 하기를 누를 때에만 불려 오므로, 그냥 두면 링크를 누르고
 * 돌아온 사람이 아무 일도 일어나지 않는 타이틀을 마주한다. 열어 주는 것이
 * 곧 "확인됐다"는 대답이다. 표는 서버가 주소에 남기는 두 가지 모양을 모두 본다
 */
function returnedFromEmailLink(): boolean {
  return (
    /(access_token|refresh_token|type=signup|type=recovery)/.test(window.location.hash) ||
    /[?&]code=/.test(window.location.search)
  )
}
if (returnedFromEmailLink()) void openCoop()

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
  ;(window as unknown as Record<string, unknown>).__music = music
}
