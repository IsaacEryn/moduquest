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
import { refreshAccountBadge } from './ui/accountBadge'
import { initTheme, spriteModeFor } from './ui/theme'
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
// 테마는 패널을 연 적 없는 사람에게도 걸려야 한다 — 부팅에서 바로 적용
initTheme(store, bus)
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
const traitPanel = new TraitPanel(port, traitStore, {
  ...pauseHooks,
  // 몸에 맞추는 일은 옵션이 한다 — 특성 창에서 그리로 가는 길을 연다
  onOpenOptions: () => options.open(),
})
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
let welcomePanel: import('./ui/welcomePanel').WelcomePanel | null = null

const slotPanel = new SlotPanel(game, saves, {
  ...pauseHooks,
  announce: (text) => announcer.polite(text),
  onStart: (slot) => {
    activeSlot = slot
    // 새 모험은 화면·소리 확인부터 — 같은 기기를 여러 사람이 쓰는 자리에서
    // 다음 사람이 이전 사람의 설정을 물려받지 않게 한다. 그다음 파티를 짠다.
    // 멀티 플레이는 같은 직업 겹침을 허용한다 — 셋 다 힐러여도 그들의 모험이다.
    // 자리마다 누가 앉는지도 함께 넘긴다 — 사람 몫인지 컴퓨터 몫인지 알고 골라야 한다
    const openParty = () => {
      const session = activeSession
      partyPanel.open({
        allowDuplicates: session !== null,
        seatOwners: session
          ? [0, 1, 2].map((n) => session.seats.find((s) => s.seat === n)?.nickname ?? null)
          : undefined,
      })
    }
    void import('./ui/welcomePanel').then(({ WelcomePanel }) => {
      welcomePanel ??= new WelcomePanel(store, { announce: (t) => announcer.polite(t) })
      welcomePanel.open(false, openParty)
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
const bagPanel = new BagPanel(port, pauseHooks, () => spriteModeFor(store.options))
const helpPanel = new HelpPanel(data, pauseHooks)
const statusPanel = new StatusPanel(port, pauseHooks, () => spriteModeFor(store.options))
const townPanel = new TownPanel(port, pauseHooks, () => spriteModeFor(store.options))
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
  () => spriteModeFor(store.options),
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
      bus,
      announce: (t) => announcer.polite(t),
      // 멀티 플레이의 기록은 계정에 붙는다 — 누가 로그인해 있느냐가 곧 어느 자리냐다
      onProfileChanged: sharedOnProfileChanged,
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
      openAccount: () => void openAccount(),
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
  if (e.type !== 'mode') return
  document.body.dataset.mode = e.mode
  // 모드가 바뀌면 기록 창의 높이도 통째로 달라진다(클리어는 접히고 필드는 지도를 따른다).
  // 남아 있던 스크롤 위치는 더 이상 바닥이 아니라서, 그대로 두면 다음 스테이지에서
  // 새 줄이 쌓여도 따라 내려가지 않는다
  textLog.scrollToBottom()
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
 * 로그인 흔적이 있을 때만 확인을 시작한다. 없으면 여기서 끝 —
 * 서버 요청 0건이고 운영 관련 코드가 내려오지도 않는다.
 */
/**
 * 로그인 상태가 바뀔 때 갈아 끼워야 하는 것들 — 저장소·운영 링크·계정 배지.
 * 어느 문(멀티 플레이 창·계정 창)으로 드나들었든 같은 길을 지난다.
 */
let signedIn = false
/** 마지막으로 서버에 밀어 둔 테마 — pull→set→optionsChanged 되울림을 끊는 기준 */
let lastSyncedTheme: string | null = null

/** 테마를 계정과 잇는다 — 서버 값이 있으면 그쪽이 이긴다(마지막 저장 기기 우선) */
function startThemeSync(): void {
  signedIn = true
  void import('./net/settingsSync').then(async (sync) => {
    const remote = await sync.pullTheme()
    if (remote) {
      lastSyncedTheme = remote
      if (store.options.theme !== remote) store.set('theme', remote)
    } else {
      lastSyncedTheme = store.options.theme
      await sync.pushTheme(store.options.theme)
    }
  })
}

async function sharedOnProfileChanged(profile: { userId: string } | null): Promise<void> {
  if (profile) {
    await useAccountSaves(profile.userId)
    startThemeSync()
  } else {
    signedIn = false
    useDeviceSaves()
    lastSyncedTheme = null
  }
  refreshAdminLink()
  refreshAccountBadge(() => void openAccount())
}

// 로그인 중에 테마를 바꾸면 서버에도 적는다 — 비로그인은 이 줄이 아무것도 하지 않는다
bus.on((e) => {
  if (e.type !== 'optionsChanged' || !signedIn) return
  if (lastSyncedTheme === store.options.theme) return
  lastSyncedTheme = store.options.theme
  void import('./net/settingsSync').then((sync) => sync.pushTheme(store.options.theme))
})

let accountPanel: import('./ui/accountPanel').AccountPanel | null = null

/** 계정 창 — 로그인·내 정보. 창을 겹쳐 열지 않는 관례를 따른다 */
async function openAccount(): Promise<void> {
  coopPanel?.close()
  if (!accountPanel) {
    const { AccountPanel } = await import('./ui/accountPanel')
    accountPanel = new AccountPanel({
      ...pauseHooks,
      bus,
      announce: (t) => announcer.polite(t),
      onProfileChanged: sharedOnProfileChanged,
    })
  }
  await accountPanel.open()
}

function refreshAdminLink(): void {
  // 이미 붙은 링크는 먼저 거둔다 — 계정이 바뀌었을 수 있다
  document.getElementById('admin-link')?.remove()
  const signedIn = Object.keys(localStorage).some(
    (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
  )
  if (!signedIn) return
  void import('./net/adminLink').then((m) => m.attachAdminLink())
}

refreshAdminLink()
refreshAccountBadge(() => void openAccount())
// 이미 로그인된 채로 켜졌으면 테마 동기화도 바로 잇는다.
// 저장소 전환과 다르다 — 어느 문으로 들어갈지는 여전히 사람이 정한다
if (
  Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
) {
  startThemeSync()
}

// --- 편의 옵션 발견 유도 — 처음 한 번, 강요 없이 ---
import('./ui/tips').then(({ Tips, WELCOME_ID, hasSeenTip, markTipSeen }) => {
  // 첫 방문이면 환영 설정을 연다. 게임 흐름에 들어가기 전이라 저장·락스텝과 무관하다
  if (!hasSeenTip(WELCOME_ID) && game.mode === 'title') {
    void import('./ui/welcomePanel').then(({ WelcomePanel }) => {
      markTipSeen(WELCOME_ID)
      welcomePanel ??= new WelcomePanel(store, { announce: (t) => announcer.polite(t) })
      welcomePanel.open()
    })
  }

  // 게임 중 맥락 팁 — 각각 평생 한 번, 한 세션에 하나만
  const tips = new Tips((t) => announcer.polite(t))
  bus.on((e) => {
    if (e.type === 'battleStart') {
      tips.show('battle-captions', '소리가 없어도 자막과 낭독으로 전투를 따라갈 수 있다 — 옵션에서 맞출 수 있다.')
    }
    // 필드에 처음 선 순간 — 어느 길로 왔든(새 모험·이어서 하기) mode가 말해 준다
    if (e.type === 'mode' && e.mode === 'field') {
      tips.show('field-text', '글씨가 작으면 옵션에서 큰 글씨를 켤 수 있다.')
    }
  })
})

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

// --- 새 판이 올라온 뒤에도 열려 있던 화면 ---
/*
  배포가 나가면 옛 index가 가리키던 조각 이름이 사라진다. 그때 화면을 여는
  동적 import가 404로 실패하는데, 부르는 쪽이 전부 `void import(...)`라
  아무 일도 일어나지 않은 것처럼 보였다. 실제로 배포 직후 열어 둔 창에서
  멀티 플레이 문을 눌렀더니 반응이 없었다 — 눌렀는데 아무 말도 없는 것이
  가장 나쁜 실패다. 무엇이 일어났는지는 말해 줘야 한다.

  아직 아무것도 시작하지 않았으면 조용히 새로 받는다(잃을 것이 없다).
  걷는 중이면 스스로 정하게 둔다 — 함께 하기 중에 멋대로 새로고침하면
  그 자리가 이탈로 처리되어 동료의 화면까지 흔든다.
*/
function showStaleBuildBar(): void {
  if (document.querySelector('#stale-build')) return
  const bar = document.createElement('div')
  bar.id = 'stale-build'
  bar.className = 'stale-build'
  bar.setAttribute('role', 'status')
  const text = document.createElement('p')
  text.textContent = '새 판이 올라왔다. 새로고침하면 이어서 할 수 있다.'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '새로고침'
  button.addEventListener('click', () => location.reload())
  bar.append(text, button)
  document.querySelector('#app')?.append(bar)
  // 손은 뺏지 않는다. role=status가 읽어 주고 줄은 사라지지 않으므로,
  // 걷던 중이라면 하던 것을 마치고 눌러도 된다
}

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string } | undefined
  const message = String(reason?.message ?? e.reason ?? '')
  if (!/dynamically imported module|Importing a module script failed/i.test(message)) return
  e.preventDefault()
  if (game.mode === 'title') {
    location.reload()
    return
  }
  announcer.assertive('새 판이 올라왔다. 새로고침하면 이어서 할 수 있다.')
  showStaleBuildBar()
})
