import { describe, expect, it } from 'vitest'
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
import { EventBus } from './events'
import { Game, type TurnScheduler } from './game'
import { memberIdsOf, memberNamesOf } from './partyIds'
import { sanitizeSnapshot } from './save'
import type { GameData, StageData, TraitsFile } from './types'

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

const scheduler: TurnScheduler = { schedule: () => 1, cancel: () => {} }

function makeGame() {
  return new Game(DATA, new EventBus(), scheduler)
}

describe('파티원 이름표 — 겹쳐도 갈리지 않는다', () => {
  it('중복이 없으면 id가 직업 그대로다 — 지금까지의 모든 저장이 이 경우다', () => {
    expect(memberIdsOf(['warrior', 'healer', 'mage'])).toEqual(['warrior', 'healer', 'mage'])
  })

  it('겹치면 두 번째부터 번호가 붙는다', () => {
    expect(memberIdsOf(['healer', 'healer', 'healer'])).toEqual([
      'healer',
      'healer2',
      'healer3',
    ])
    expect(memberIdsOf(['warrior', 'healer', 'warrior'])).toEqual([
      'warrior',
      'healer',
      'warrior2',
    ])
  })

  it('이름도 같은 규칙이다 — 같은 이름 둘로는 대상을 부를 수 없다', () => {
    const names = memberNamesOf(['healer', 'healer', 'rogue'], (j) => DATA.jobs[j].name)
    expect(names).toEqual(['힐러', '힐러 2', '도적'])
  })
})

describe('중복 직업 파티 — 코어가 받아들이고 갈라 다룬다', () => {
  it('같은 직업 셋도 파티다', () => {
    const g = makeGame()
    expect(g.setParty(['healer', 'healer', 'healer'])).toBe(true)
    expect(g.party.map((c) => c.id)).toEqual(['healer', 'healer2', 'healer3'])
    expect(g.party.map((c) => c.name)).toEqual(['힐러', '힐러 2', '힐러 3'])
  })

  it('장비는 각자의 것이다 — 같은 직업 둘이 하나의 옷장을 나누지 않는다', () => {
    const g = makeGame()
    g.setParty(['mage', 'mage', 'warrior'])
    const bag = g as unknown as { addItem: (id: string) => void }
    bag.addItem('wood_staff')
    expect(g.equip('mage', 'wood_staff')).toBe(true)
    expect(g.equipmentOf('mage').weapon).toBe('wood_staff')
    expect(g.equipmentOf('mage2').weapon).toBeUndefined()
  })

  it('전용 장비 판정은 직업으로 한다 — 두 번째 마법사도 지팡이를 든다', () => {
    const g = makeGame()
    g.setParty(['mage', 'mage', 'warrior'])
    const bag = g as unknown as { addItem: (id: string) => void }
    bag.addItem('wood_staff')
    expect(g.canEquip('mage2', 'wood_staff').ok).toBe(true)
    // 전사는 여전히 못 든다
    bag.addItem('wood_staff')
    expect(g.canEquip('warrior', 'wood_staff').ok).toBe(false)
  })

  it('파티를 바꾸면 떠나는 자리의 장비만 가방으로 돌아온다', () => {
    const g = makeGame()
    g.setParty(['warrior', 'warrior', 'healer'])
    const bag = g as unknown as {
      addItem: (id: string) => void
      inventory: Map<string, number>
    }
    bag.addItem('wood_sword')
    bag.addItem('wood_sword')
    g.equip('warrior', 'wood_sword')
    g.equip('warrior2', 'wood_sword')
    // 전사 하나가 떠난다 — warrior2의 검만 가방으로
    g.setParty(['warrior', 'healer', 'mage'])
    expect(g.equipmentOf('warrior').weapon).toBe('wood_sword')
    expect(bag.inventory.get('wood_sword') ?? 0).toBe(1)
  })

  it('강화도 사람 단위다 — 첫 전사를 올려도 둘째 전사는 그대로다', () => {
    const g = makeGame()
    g.setParty(['warrior', 'warrior', 'healer'])
    const wallet = g as unknown as { gold: number; materials: number }
    wallet.gold = 999
    wallet.materials = 99
    // 강화는 마을에서만 — clear 상태로 우회
    const inner = g as unknown as { mode: string }
    inner.mode = 'clear'
    expect(g.upgrade('warrior', 'atk')).toBe(true)
    expect(g.upgradeLevelOf('warrior', 'atk')).toBe(1)
    expect(g.upgradeLevelOf('warrior2', 'atk')).toBe(0)
    const first = g.statBreakdownOf('warrior')!
    const second = g.statBreakdownOf('warrior2')!
    expect(first.total.patk).toBeGreaterThan(second.total.patk)
  })

  it('중복 파티도 저장하고 그대로 돌아온다', () => {
    const g = makeGame()
    g.setParty(['healer', 'healer', 'rogue'])
    g.start()
    let guard = 0
    while (g.mode === 'dialogue' && guard++ < 50) g.advanceDialogue()
    // 장비는 출발 뒤에 얻는다 — 새 모험이 지난 판의 자취를 지우기 때문이다
    const bag = g as unknown as { addItem: (id: string) => void }
    bag.addItem('wood_staff')
    expect(g.equip('healer2', 'wood_staff')).toBe(true)

    const snap = g.snapshot()
    expect(snap.party.map((p) => p.job)).toEqual(['healer', 'healer', 'rogue'])

    const clean = sanitizeSnapshot(snap, DATA)
    expect(clean).not.toBeNull()
    const g2 = makeGame()
    g2.restore(clean!)
    expect(g2.party.map((c) => c.id)).toEqual(['healer', 'healer2', 'rogue'])
    // 장비가 같은 자리로 돌아왔다
    expect(g2.equipmentOf('healer2').weapon).toBe('wood_staff')
    expect(g2.equipmentOf('healer').weapon).toBeUndefined()
  })
})

describe('출발 전 좌석 알림', () => {
  it('타이틀에서는 자리가 바뀌어도 말하지 않는다 — 부를 이름이 아직 없다', () => {
    const bus = new EventBus()
    const heard: string[] = []
    bus.on((e) => {
      if (e.type === 'seatControlChanged') heard.push(e.memberName)
    })
    const g = new Game(DATA, bus, scheduler)
    g.setParty(['healer', 'healer', 'healer'])
    g.setSeatController(1, 'human')
    expect(heard).toEqual([])
    // 자리 자체는 바뀌어 있다 — 말하지 않을 뿐이다
    expect(g.seatControllerOf(1)).toBe('human')
  })

  it('출발한 뒤에는 확정된 파티의 이름으로 말한다', () => {
    const bus = new EventBus()
    const heard: string[] = []
    bus.on((e) => {
      if (e.type === 'seatControlChanged') heard.push(e.memberName)
    })
    const g = new Game(DATA, bus, scheduler)
    g.setParty(['healer', 'healer', 'healer'])
    g.start()
    let guard = 0
    while (g.mode === 'dialogue' && guard++ < 50) g.advanceDialogue()
    g.setSeatController(1, 'human')
    expect(heard).toEqual(['힐러 2'])
  })
})
