import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import economy from '../data/economy.json'
import items from '../data/items.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import sets from '../data/sets.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'
import { EventBus } from '../core/events'
import { Game, type TurnScheduler } from '../core/game'
import type { GameData, StageData, TraitsFile } from '../core/types'
import type { OpenChannel, PartyChannel } from './channel'
import { worldChecksum } from './checksum'
import { PartySession, type SessionHooks } from './session'

/**
 * 함께 하기를 전선 없이 세운다. 두 화면이 같은 채널을 공유하고, 시험이
 * 그 사이의 배달을 마음대로 끊을 수 있다 — 유실·사칭·예외를 재현하는 자리다.
 *
 * 여기 있는 것은 전부 실제 배선과 같은 길을 지난다. 시퀀서만 따로 시험하면
 * "발신자를 누가 정하는가" 같은 배선의 결함이 보이지 않는다.
 */

const DATA: GameData = {
  jobs: jobs as GameData['jobs'],
  monsters: monsters as GameData['monsters'],
  party,
  progression,
  items: items as GameData['items'],
  sets: sets as GameData['sets'],
  economy: economy as GameData['economy'],
  stages: [stage1, stage2, stage3] as StageData[],
  traits: traitsFile as TraitsFile,
}

/** 채널 하나를 나눠 쓰는 여러 화면. 배달은 시험이 쥔다 */
class FakeWire {
  /** userId → 이벤트별 수신자 */
  private members = new Map<string, Map<string, ((p: unknown) => void)[]>>()
  private presence = new Map<string, Record<string, unknown>>()
  private presenceHooks = new Map<string, { join: ((id: string) => void)[]; leave: ((id: string) => void)[] }>()
  /** 오간 것 전부 — 무엇이 나갔는지 보는 창 */
  sent: { from: string; event: string; payload: unknown }[] = []
  /** 이 이름의 이벤트는 배달하지 않는다 — 유실을 만드는 손잡이 */
  dropping = new Set<string>()
  /** 특정 seq의 apply만 떨어뜨린다 */
  dropSeq: number | null = null

  open: OpenChannel = (_topic, userId) => {
    const handlers = new Map<string, ((p: unknown) => void)[]>()
    this.members.set(userId, handlers)
    this.presenceHooks.set(userId, { join: [], leave: [] })
    const channel: PartyChannel = {
      onBroadcast: (event, cb) => {
        const list = handlers.get(event) ?? []
        list.push(cb)
        handlers.set(event, list)
      },
      onPresence: (event, cb) => {
        this.presenceHooks.get(userId)![event].push(cb)
      },
      subscribe: async () => {},
      send: (event, payload) => this.deliver(userId, event, payload),
      track: (p) => {
        this.presence.set(userId, p)
        // 이미 들어와 있던 사람들에게 내 도착을 알린다
        for (const [other, hooks] of this.presenceHooks) {
          if (other !== userId) for (const fn of hooks.join) fn(userId)
        }
      },
      presenceOf: (id) => this.presence.get(id) ?? null,
      close: () => {
        this.members.delete(userId)
        this.presence.delete(userId)
        this.presenceHooks.delete(userId)
        for (const [other, hooks] of this.presenceHooks) {
          if (other !== userId) for (const fn of hooks.leave) fn(userId)
        }
      },
    }
    return channel
  }

  private deliver(from: string, event: string, payload: unknown): void {
    this.sent.push({ from, event, payload })
    if (this.dropping.has(event)) return
    if (
      event === 'apply' &&
      this.dropSeq !== null &&
      (payload as { seq?: number }).seq === this.dropSeq
    ) {
      return
    }
    for (const [userId, handlers] of [...this.members]) {
      if (userId === from) continue // self: false
      for (const fn of handlers.get(event) ?? []) fn(payload)
    }
  }

  /** 아무도 아닌 자가 채널에 끼어들어 한 마디 던진다 */
  inject(event: string, payload: unknown, to?: string): void {
    for (const [userId, handlers] of [...this.members]) {
      if (to && userId !== to) continue
      for (const fn of handlers.get(event) ?? []) fn(payload)
    }
  }

  /** presence에만 올라와 있고 자리는 못 받은 사람 */
  lurk(userId: string): void {
    this.presence.set(userId, { nickname: 'lurker' })
  }
}

function makeSide(bus = new EventBus()) {
  const scheduler: TurnScheduler = { schedule: () => 1, cancel: () => {} }
  const game = new Game(DATA, bus, scheduler)
  const said: string[] = []
  const hooks: SessionHooks = {
    announce: (t) => said.push(t),
    alert: (t) => said.push(`!${t}`),
    onRosterChanged: () => {},
    onStarted: () => {},
    onEnded: (r) => said.push(`END:${r}`),
    setLayoutKey: () => {},
    getLayoutKey: () => 0,
    installScheduler: () => {},
    restoreScheduler: () => {},
  }
  return { game, bus, hooks, said }
}

/** 호스트 하나와 게스트 하나(또는 둘)가 실제로 출발한 판 */
async function startedParty(guests = 1) {
  const wire = new FakeWire()
  const h = makeSide()
  const host = await PartySession.host(
    h.game,
    DATA,
    h.bus,
    h.hooks,
    { userId: 'host-1', nickname: '방장' },
    wire.open,
  )
  const sides = []
  const joined = []
  for (let i = 1; i <= guests; i++) {
    const side = makeSide()
    sides.push(side)
    joined.push(
      await PartySession.join(
        host.code,
        side.game,
        DATA,
        side.bus,
        side.hooks,
        { userId: `guest-${i}`, nickname: `동료${i}` },
        wire.open,
      ),
    )
  }
  host.startNew(['warrior', 'healer', 'archer'])
  // 시작 대사를 넘겨 필드까지 나온다 — 저장도 동기화도 필드에서만 되므로,
  // 대사 화면에 멈춘 채로 시험하면 검사하려던 길을 절반도 지나지 않는다
  for (let i = 0; i < 20 && h.game.mode === 'dialogue'; i++) {
    host.propose({ kind: 'advanceDialogue' })
  }
  return { wire, host, guest: joined[0], guests: joined, h, g: sides[0], sides }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('함께 하기 — 출발과 자리', () => {
  it('두 화면이 같은 출발 조건에서 같은 세계로 간다', async () => {
    const { host, guest, h, g } = await startedParty()
    expect(host.started).toBe(true)
    expect(guest.started).toBe(true)
    expect(guest.mySeat).toBe(1)
    expect(h.game.party.map((c) => c.id)).toEqual(g.game.party.map((c) => c.id))
    // 자리 배치가 출발 조건에 실려 왔으므로 사람 자리가 두 화면에서 같다
    expect(h.game.party.map((c) => c.isPlayer)).toEqual(g.game.party.map((c) => c.isPlayer))
    expect(g.game.seatControllerOf(1)).toBe('human')
  })

  it('출발 조건이 자리 배치를 싣는다 — 각자의 명부를 근거로 삼지 않는다', async () => {
    const { wire } = await startedParty()
    const seed = wire.sent.find((m) => m.event === 'seed')!.payload as { seats: unknown[] }
    expect(seed.seats).toHaveLength(2)
  })
})

describe('함께 하기 — 부정한 발신자', () => {
  it('명부 밖 사람의 확정 명령은 받지 않는다', async () => {
    const { wire, guest, g } = await startedParty()
    const before = g.game.field.pos.x
    // 자리를 못 받은 채 채널에만 들어온 사람이 호스트를 사칭한다
    wire.lurk('stranger')
    wire.inject(
      'apply',
      { v: 1, seq: 1, seat: 0, cmd: { kind: 'move', dir: 'east' }, from: 'stranger' },
      'guest-1',
    )
    expect(g.game.field.pos.x).toBe(before)
    expect(guest.started).toBe(true)
  })

  it('사칭한 세션 종료 명령에 모험이 끝나지 않는다', async () => {
    const { wire, g } = await startedParty()
    wire.lurk('stranger')
    wire.inject(
      'apply',
      { v: 1, seq: 1, seat: 0, cmd: { kind: 'endSession' }, from: 'stranger' },
      'guest-1',
    )
    expect(g.said.some((s) => s.startsWith('END:'))).toBe(false)
  })

  it('위조 스냅샷으로 게스트의 세계를 바꿔치지 못한다', async () => {
    const { wire, g } = await startedParty()
    wire.lurk('stranger')
    const gold = g.game.currentGold
    wire.inject(
      'sync',
      {
        v: 1,
        seq: 9,
        snapshot: { ...g.game.snapshot(), gold: 99999 },
        seats: [{ seat: 0, userId: 'stranger', nickname: 'x', controller: 'human' }],
        moveTokenSeat: 0,
        layoutKey: 0,
        from: 'stranger',
      },
      'guest-1',
    )
    expect(g.game.currentGold).toBe(gold)
  })

  it('동료가 다른 동료의 자리를 사칭해 조작권을 가져가지 못한다', async () => {
    const { wire, host, h } = await startedParty(2)
    // 길잡이를 1번 자리에 준다 — 이제 필드 이동은 1번의 몫이다
    host.propose({ kind: 'token', toSeat: 1 })
    expect(h.game.moveTokenSeat).toBe(1)
    const before = host.appliedSeq

    // 2번 자리 사람이 1번 좌석을 적어 남의 발걸음을 대신 걷는다.
    // 명부에 1번이 사람으로 앉아 있다는 것만 보던 예전 판정은 이걸 통과시켰다
    wire.inject(
      'propose',
      { v: 1, seat: 1, nonce: 'spoof', cmd: { kind: 'move', dir: 'east' }, from: 'guest-2' },
      'host-1',
    )
    expect(host.appliedSeq).toBe(before) // 확정되지 않았다

    // 자기 자리로 낸 명령은 그대로 받는다 — 막는 것은 사칭이지 참여가 아니다
    wire.inject(
      'propose',
      { v: 1, seat: 2, nonce: 'ok', cmd: { kind: 'move', dir: 'east' }, from: 'guest-2' },
      'host-1',
    )
    expect(host.appliedSeq).toBe(before + 1)
  })

  it('게스트가 방장 자리를 사칭해 방장 전용 명령을 내지 못한다', async () => {
    const { wire, h } = await startedParty()
    wire.inject(
      'propose',
      { v: 1, seat: 0, nonce: 'spoof', cmd: { kind: 'nextStage' }, from: 'guest-1' },
      'host-1',
    )
    expect(h.game.currentStageIndex).toBe(0)
  })
})

describe('함께 하기 — 어긋남에서 돌아오는 길', () => {
  it('봉투를 잃어도 재전송으로 따라잡는다 — 스냅샷을 기다리지 않는다', async () => {
    const { wire, host, guest, h, g } = await startedParty()
    const stuckAt = guest.appliedSeq
    // 다음 봉투를 떨어뜨린다. 그 다음이 도착해야 게스트가 구멍을 안다
    wire.dropSeq = host.appliedSeq + 1
    host.propose({ kind: 'move', dir: 'east' })
    wire.dropSeq = null
    host.propose({ kind: 'move', dir: 'east' })

    expect(guest.appliedSeq).toBe(stuckAt) // 구멍 뒤로는 하나도 못 나아갔다
    expect(host.appliedSeq).toBe(stuckAt + 2)

    // 물러서며 청하면 호스트가 잃은 봉투만 되쏜다 — 스냅샷 경로와 달리 전투 중에도 된다
    await vi.advanceTimersByTimeAsync(4000)
    expect(guest.appliedSeq).toBe(host.appliedSeq)
    expect(g.game.field.pos).toEqual(h.game.field.pos)
  })

  it('동기화 요청은 한 번으로 끝나지 않는다', async () => {
    const { wire, host } = await startedParty()
    wire.dropSeq = host.appliedSeq + 1
    host.propose({ kind: 'move', dir: 'east' })
    wire.dropSeq = null
    host.propose({ kind: 'move', dir: 'east' })
    wire.dropping.add('sync_req') // 청하는 소리마저 잃는다
    await vi.advanceTimersByTimeAsync(60_000)
    const tries = wire.sent.filter((m) => m.event === 'sync_req').length
    expect(tries).toBeGreaterThan(1)
  })

  it('적용이 던지면 조용히 지나가지 않고 다시 맞추기를 청한다', async () => {
    const { wire, host, guest, g } = await startedParty()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const real = g.game.moveField.bind(g.game)
    let first = true
    // 코어가 한 번 던지는 상황 — 예전에는 번호만 소비되고 아무도 몰랐다
    g.game.moveField = ((dir, seat) => {
      if (first) {
        first = false
        throw new Error('적용 실패')
      }
      return real(dir, seat)
    }) as typeof g.game.moveField

    const next = guest.appliedSeq + 1
    const env = (seq: number) => ({
      v: 1,
      seq,
      seat: 0,
      cmd: { kind: 'move', dir: 'east' },
      from: 'host-1',
    })
    wire.inject('apply', env(next), 'guest-1')
    // 갈렸다는 사실이 사람에게도(낭독) 방장에게도(요청) 도달한다.
    // 예전에는 번호만 조용히 소비되고 아무도 몰랐다
    expect(g.said.some((s) => s.startsWith('!'))).toBe(true)
    expect(wire.sent.some((m) => m.event === 'sync_req' && m.from === 'guest-1')).toBe(true)
    // 그리고 실제로 방장의 기준으로 되돌아온다
    expect(guest.appliedSeq).toBe(host.appliedSeq)
    quiet.mockRestore()
  })
})

describe('함께 하기 — 어긋남 감지', () => {
  it('같은 순간이 아니면 견주지 않는다 — 걸음 한 번 차이로 되돌리지 않는다', async () => {
    const { wire, host } = await startedParty()
    // 게스트가 지난 번호에서 낸 해시. 예전에는 이걸 받은 시점의 호스트 해시와
    // 견줘서 멀쩡한 파티가 상시 되돌려졌다
    const at = host.appliedSeq
    wire.inject('checksum', { v: 1, seq: at + 99, hash: 12345, from: 'guest-1' }, 'host-1')
    expect(wire.sent.some((m) => m.event === 'sync')).toBe(false)
    expect(host.appliedSeq).toBe(at)
  })

  it('전투가 갈리면 스냅샷이 같아도 알아챈다', async () => {
    const { wire, host, h, g } = await startedParty()
    // 두 화면의 진행도는 같지만 한쪽 전투 상태만 다르게 만든다.
    // 예전 체크섬은 저장 스냅샷만 봐서 이 어긋남을 통과시켰다
    const same = worldChecksum(g.game.snapshot(), g.game.liveFingerprint())
    expect(worldChecksum(h.game.snapshot(), h.game.liveFingerprint())).toBe(same)

    g.game.moveTokenSeat = 2 // 길잡이가 갈렸다 — 저장에는 없는 값이다
    const drifted = worldChecksum(g.game.snapshot(), g.game.liveFingerprint())
    expect(drifted).not.toBe(same)

    wire.inject(
      'checksum',
      { v: 1, seq: host.appliedSeq, hash: drifted, from: 'guest-1' },
      'host-1',
    )
    expect(wire.sent.some((m) => m.event === 'sync')).toBe(true)
  })
})

describe('함께 하기 — 뒷정리', () => {
  it('세션이 끝나면 버스 구독을 반납한다', async () => {
    const { host, h } = await startedParty()
    const before = h.bus.listenerCount
    host.finish()
    expect(h.bus.listenerCount).toBeLessThan(before)
  })
})

/**
 * 같은 결함이 함께 하기에서는 다른 얼굴로 나타났다. 방장의 Game은 화면이 살아 있는
 * 동안 하나뿐이라, 혼자 한 판 걷고 나서 모험단을 열면 방장만 지난 판의 레벨과 지갑을
 * 안고 출발했다. 동료는 처음부터라 첫 걸음부터 다른 세계였다.
 *
 * 체크섬이 잡아 주기는 하지만, 그건 어긋난 뒤에 되맞추는 일이다. 애초에 어긋나지
 * 않는 편이 낫다.
 */
describe('함께 하기 — 새 모험은 모두에게 처음이다', () => {
  it('방장이 혼자 걷던 판이 있어도 전원이 같은 지점에서 출발한다', async () => {
    const wire = new FakeWire()
    const h = makeSide()
    const g = makeSide()

    // 방장은 혼자 한참 걷다가 타이틀로 나온 참이다 — 모험단은 타이틀에서만 연다
    h.game.start()
    const snap = h.game.snapshot()
    h.game.restore({ ...snap, xp: 200, gold: 500, materials: 30 })
    expect(h.game.partyLevel).toBeGreaterThan(1)
    h.game.returnToTitle()

    const host = await PartySession.host(
      h.game, DATA, h.bus, h.hooks,
      { userId: 'host-1', nickname: '방장' }, wire.open,
    )
    const guest = await PartySession.join(
      host.code, g.game, DATA, g.bus, g.hooks,
      { userId: 'guest-1', nickname: '동료' }, wire.open,
    )
    host.startNew(['warrior', 'healer', 'archer'])

    expect(h.game.partyLevel).toBe(1)
    expect(h.game.currentGold).toBe(0)
    expect(h.game.partyLevel).toBe(g.game.partyLevel)
    expect(h.game.currentGold).toBe(g.game.currentGold)
    // 세계가 실제로 같은지 — 어긋남 감지가 쓰는 바로 그 잣대로 본다
    expect(worldChecksum(h.game.snapshot(), h.game.liveFingerprint())).toBe(
      worldChecksum(g.game.snapshot(), g.game.liveFingerprint()),
    )
    expect(guest.started).toBe(true)
  })
})
