import { describe, expect, it } from 'vitest'
import { EventBus } from './events'
import { Game } from './game'
import { SAVE_VERSION, progressScore, sanitizeSnapshot } from './save'
import type { GameData, SaveSnapshot, StageData, TraitsFile } from './types'
import economy from '../data/economy.json'
import items from '../data/items.json'
import sets from '../data/sets.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import { resolveArea } from './layout'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

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

/** 스테이지1 첫 구역의 시작 칸 — 좌표를 손으로 적지 않는다 */
const START1 = resolveArea(DATA.stages[0], 'a', 0).entryAt(null)

function makeGame() {
  const bus = new EventBus()
  return new Game(DATA, bus, { schedule: () => null, cancel: () => {} }, null, () => 1000)
}

function skipDialogue(game: Game) {
  let guard = 0
  while (game.mode === 'dialogue' && guard++ < 50) game.advanceDialogue()
}

const valid = (): SaveSnapshot => makeGame().snapshot()

describe('저장과 복원', () => {
  it('저장했다가 되돌리면 같은 상태가 된다', () => {
    const a = makeGame()
    a.start()
    skipDialogue(a)
    a.moveField('east')
    a.moveField('east')
    a.player.hp = 40
    const snapshot = a.snapshot()

    const b = makeGame()
    b.restore(snapshot)
    expect(b.currentStageIndex).toBe(a.currentStageIndex)
    expect(b.field.pos).toEqual(a.field.pos)
    expect(b.player.hp).toBe(40)
    expect(b.mode).toBe('field')
  })

  it('처치한 조우가 되살아나지 않는다', () => {
    const a = makeGame()
    a.start()
    skipDialogue(a)
    a.field.removeEncounter('e1')
    const snapshot = a.snapshot()
    expect(snapshot.field.defeated).toContain('e1')

    const b = makeGame()
    b.restore(snapshot)
    expect(b.field.alive.has('e1')).toBe(false)
  })

  it('특성과 쉼터 도달이 함께 복원된다', () => {
    const a = makeGame()
    a.setTrait('swift-step')
    a.start()
    skipDialogue(a)
    a.field.checkpointReached = true
    const b = makeGame()
    b.restore(a.snapshot())
    expect(b.currentTraitId).toBe('swift-step')
    expect(b.field.checkpointReached).toBe(true)
    expect(b.player.spd).toBe(a.player.spd)
  })

  it('전투나 대사 중에는 저장하지 않는다', () => {
    const g = makeGame()
    expect(g.canSave).toBe(false) // 타이틀
    g.start()
    expect(g.canSave).toBe(false) // 인트로 대사
    skipDialogue(g)
    expect(g.canSave).toBe(true) // 필드
  })

  it('상자·인벤토리·처치 수가 함께 저장되고 복원된다', () => {
    const a = makeGame()
    a.start()
    skipDialogue(a)
    a.field.pos = { x: 3, y: 4 }
    a.moveField('west') // (2,4) 보물상자
    const snapshot = a.snapshot()
    expect(snapshot.field.openedChests).toEqual(['a-t1'])
    expect(snapshot.inventory).toEqual([
      { item: 'potion_small', count: 1 },
      { item: 'leather_armor', count: 1 },
    ])

    const b = makeGame()
    b.restore(snapshot)
    expect(b.inventoryList[0]).toMatchObject({ id: 'potion_small', count: 1 })
    expect(b.field.openedChestIds).toEqual(['a-t1']) // 되살아나지 않는다
  })

  it('진행도는 되돌아가지 않는다', () => {
    const g = makeGame()
    g.start()
    skipDialogue(g)
    const before = progressScore(g.snapshot())
    g.field.removeEncounter('e1')
    expect(progressScore(g.snapshot())).toBeGreaterThan(before)
  })
})

describe('저장값 검증 — 깨진 값이 게임을 죽이지 않는다', () => {
  it('제대로 된 값은 그대로 통과한다', () => {
    const s = valid()
    expect(sanitizeSnapshot(s, DATA)).toEqual(s)
  })

  it.each([
    ['null', null],
    ['숫자', 42],
    ['문자열', '{}'],
    ['배열', []],
    ['빈 객체', {}],
  ])('%s은 읽지 않는다', (_label, raw) => {
    expect(sanitizeSnapshot(raw, DATA)).toBeNull()
  })

  it('모르는 상위 버전은 거부한다', () => {
    expect(sanitizeSnapshot({ ...valid(), schemaVersion: 99 }, DATA)).toBeNull()
  })

  it('없는 스테이지 번호는 범위 안으로 당긴다', () => {
    expect(sanitizeSnapshot({ ...valid(), stageIndex: 99 }, DATA)?.stageIndex).toBe(2)
    expect(sanitizeSnapshot({ ...valid(), stageIndex: -5 }, DATA)?.stageIndex).toBe(0)
  })

  it('맵 밖이나 벽 위의 좌표는 시작점으로 되돌린다', () => {
    const outside = sanitizeSnapshot(
      { ...valid(), field: { ...valid().field, pos: { x: 999, y: 999 } } },
      DATA,
    )
    expect(outside?.field.pos).toEqual(START1)

    const onWall = sanitizeSnapshot(
      { ...valid(), field: { ...valid().field, pos: { x: 0, y: 0 } } },
      DATA,
    )
    expect(onWall?.field.pos).toEqual(START1)
  })

  it('없는 조우·대사 키는 버린다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        field: { ...valid().field, defeated: ['a-e1', '없는조우', 'a-e1'] },
        seenDialogues: ['intro', '없는대사'],
        clearedStages: ['stage1', '없는스테이지'],
      },
      DATA,
    )
    expect(s?.field.defeated).toEqual(['a-e1']) // 중복도 정리된다
    expect(s?.seenDialogues).toEqual(['intro'])
    expect(s?.clearedStages).toEqual(['stage1'])
  })

  it('파티 구성이 깨져 있으면 기본 구성으로 되돌린다', () => {
    // 없는 직업이 섞이거나 정원이 모자라면 구성 전체를 기본값으로
    const broken = sanitizeSnapshot(
      { ...valid(), party: [{ job: 'rogue', hp: 10, equipment: {} }, { job: '없는직업', hp: 10 }] },
      DATA,
    )
    expect(broken?.party.map((p) => p.job)).toEqual(['rogue', 'warrior', 'healer'])

    // 같은 직업이 겹치는 것은 깨진 게 아니라 유효한 파티다 — 함께 하기에서
    // 세 사람이 같은 직업을 고를 수 있고, 그 저장도 그대로 살아야 한다
    const dup = sanitizeSnapshot(
      {
        ...valid(),
        party: [
          { job: 'healer', hp: 10, equipment: {} },
          { job: 'healer', hp: 10, equipment: {} },
          { job: 'rogue', hp: 10, equipment: {} },
        ],
      },
      DATA,
    )
    expect(dup?.party.map((p) => p.job)).toEqual(['healer', 'healer', 'rogue'])
  })

  it('바꾼 파티 구성은 그대로 저장되고 복원된다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        party: [
          { job: 'mage', hp: 40, equipment: {} },
          { job: 'archer', hp: 50, equipment: {} },
          { job: 'healer', hp: 60, equipment: {} },
        ],
      },
      DATA,
    )
    expect(s?.party.map((p) => p.job)).toEqual(['mage', 'archer', 'healer'])
  })

  it('없는 아이템·몹·상자 id는 버리고 개수는 상한을 지킨다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        field: { ...valid().field, openedChests: ['a-t1', '없는상자', 'a-t1'] },
        inventory: [
          { item: 'potion_small', count: 500 },
          { item: '없는아이템', count: 1 },
        ],
        kills: [
          { monster: 'slime', count: 5 },
          { monster: '없는몹', count: 2 },
        ],
      },
      DATA,
    )
    expect(s?.field.openedChests).toEqual(['a-t1'])
    expect(s?.inventory).toEqual([{ item: 'potion_small', count: 99 }])
    expect(s?.kills).toEqual([{ monster: 'slime', count: 5 }])
  })

  it('모르는 특성은 기본값으로 되돌린다', () => {
    expect(sanitizeSnapshot({ ...valid(), traitId: '없는특성' }, DATA)?.traitId).toBe(
      DATA.traits.default,
    )
  })

  it('말이 안 되는 체력도 그대로 두지 않는다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        party: [
          { job: 'rogue', hp: -50 },
          { job: 'warrior', hp: 120, equipment: {} },
          { job: 'healer', hp: 80, equipment: {} },
        ],
      },
      DATA,
    )
    expect(s?.party[0].hp).toBe(0)
  })


  it('장비 검증 — 슬롯 불일치와 레벨 미달은 가방으로 강등된다', () => {
    const base = valid() // xp 0 → 1레벨
    const s = sanitizeSnapshot(
      {
        ...base,
        party: [
          {
            job: 'rogue',
            hp: 50,
            equipment: {
              weapon: 'chain_armor', // 슬롯 불일치 (갑옷을 무기 칸에)
              armor: 'echo_armor', // 4레벨 조건 미달
              shoes: 'leather_shoes', // 정상
              gloves: '없는장비', // 실재하지 않음
            },
          },
          { job: 'warrior', hp: 100, equipment: {} },
          { job: 'healer', hp: 70, equipment: {} },
        ],
      },
      DATA,
    )
    expect(s?.party[0].equipment).toEqual({ shoes: 'leather_shoes' })
    // 밀려난 장비는 지워지지 않고 가방으로
    expect(s?.inventory).toEqual(
      expect.arrayContaining([
        { item: 'chain_armor', count: 1 },
        { item: 'echo_armor', count: 1 },
      ]),
    )
    expect(s?.inventory.some((e) => e.item === '없는장비')).toBe(false)
  })


  it('복원할 때 체력이 최대치를 넘지 않는다', () => {
    const g = makeGame()
    g.restore({ ...valid(), party: [{ job: 'rogue', hp: 9999, equipment: {} }] })
    expect(g.player.hp).toBe(g.player.maxHp)
  })

  it('필드가 통째로 빠져 있어도 죽지 않는다', () => {
    const { field: _f, ...rest } = valid()
    const s = sanitizeSnapshot(rest, DATA)
    expect(s?.field.pos).toEqual(START1)
    expect(s?.field.defeated).toEqual([])
  })


  it('옛 형식 기록은 받아들이지 않는다 — 어긋난 채로 잇지 않는다', () => {
    // 공격·방어가 물리와 마법으로 갈리면서 v5까지의 강화 단계는 뜻이 달라졌다.
    // 억지로 펴면 올린 적 없는 쪽이 올라간 파티가 된다
    for (const version of [1, 2, 3, 4, 5]) {
      expect(sanitizeSnapshot({ ...valid(), schemaVersion: version }, DATA), `v${version}`).toBeNull()
    }
  })

  it('말이 안 되는 지갑은 범위 안으로 당긴다', () => {
    expect(sanitizeSnapshot({ ...valid(), gold: -100 }, DATA)?.gold).toBe(0)
    expect(sanitizeSnapshot({ ...valid(), gold: 1e9 }, DATA)?.gold).toBe(99999)
    expect(sanitizeSnapshot({ ...valid(), materials: '많이' }, DATA)?.materials).toBe(0)
  })

  it('강화 기록은 실재하는 직업·능력치만, 한 쌍에 하나만 남는다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        upgrades: [
          { job: 'rogue', stat: 'atk', level: 2 },
          { job: 'rogue', stat: 'atk', level: 3 }, // 같은 쌍 중복
          { job: '없는직업', stat: 'atk', level: 1 },
          { job: 'warrior', stat: 'mp', level: 1 }, // 강화하지 않는 능력치
          { job: 'healer', stat: 'def', level: 99 }, // 상한 초과
        ],
      },
      DATA,
    )
    expect(s?.upgrades).toEqual([
      { job: 'rogue', stat: 'atk', level: 2 },
      { job: 'healer', stat: 'def', level: DATA.economy.upgrade.maxLevel },
    ])
  })

  it('버전은 항상 지금 버전으로 맞춰 나온다', () => {
    expect(sanitizeSnapshot(valid(), DATA)?.schemaVersion).toBe(SAVE_VERSION)
  })
})

/**
 * 한 판에서 쌓은 것이 하나도 빠짐없이 살아남는가.
 *
 * 조각별 검사는 위에 이미 있지만, 실제로 잃는 사고는 "이것 하나만 안 담겼다"로
 * 일어난다. 그래서 경험치·레벨·파티 구성·사람마다 다른 장비·사람마다 다른 강화·
 * 지갑·가방·처치 수를 한 판에 다 쌓아 두고 저장이 지나는 진짜 길
 * (snapshot → JSON → sanitizeSnapshot → restore)을 그대로 통과시킨다.
 */
describe('쌓은 것이 하나도 빠지지 않는다', () => {
  /** 저장이 실제로 지나는 길 — 파일에 적히고, 검증을 거쳐, 되살아난다 */
  function roundTrip(from: Game): Game {
    const wire = JSON.parse(JSON.stringify(from.snapshot())) as unknown
    const clean = sanitizeSnapshot(wire, DATA)
    expect(clean, '검증을 통과하지 못했다').not.toBeNull()
    const to = makeGame()
    to.restore(clean!)
    return to
  }

  /** 경험치·지갑·장비·강화·가방·처치 수를 고루 쌓은 한 판 */
  function playedRich() {
    const g = makeGame()
    g.setParty(['archer', 'mage', 'warrior']) // 기본과 다른 구성으로
    g.setTrait('steady-hand')
    g.start()
    skipDialogue(g)
    // 쉼터로 가서 마을에 들른다 — 강화와 상점이 열리는 유일한 자리
    const cp = g.field.currentArea.checkpoint!
    g.field.pos = { ...cp }
    g.moveField('north')
    g.moveField('south')
    skipDialogue(g)
    const seed = g as unknown as { gold: number; materials: number; xp: number }
    seed.xp = 160 // 여러 레벨 오른 상태
    seed.gold = 400
    seed.materials = 20
    // 사람마다 다른 장비 — 전용 무기라 서로 바꿔 낄 수 없는 것들로 고른다
    for (const [job, item] of [
      ['archer', 'wood_bow'],
      ['mage', 'wood_staff'],
      ['warrior', 'heavy_club'],
    ] as const) {
      expect(g.buy(item), `${item} 구매`).toBe(true)
      expect(g.equip(job, item), `${job}에게 ${item}`).toBe(true)
    }
    // 사람마다 다른 강화
    expect(g.upgrade('archer', 'atk')).toBe(true)
    expect(g.upgrade('archer', 'atk')).toBe(true)
    expect(g.upgrade('mage', 'spd')).toBe(true)
    expect(g.upgrade('warrior', 'hp')).toBe(true)
    // 가방에도 남겨 둔다
    expect(g.buy('potion_small')).toBe(true)
    expect(g.buy('potion_small')).toBe(true)
    return g
  }

  it('경험치와 레벨이 그대로 온다', () => {
    const a = playedRich()
    expect(a.partyLevel).toBeGreaterThan(1)
    const b = roundTrip(a)
    expect(b.currentXp).toBe(a.currentXp)
    expect(b.partyLevel).toBe(a.partyLevel)
    expect(b.xpToNext).toBe(a.xpToNext)
  })

  it('파티 구성이 순서까지 그대로 온다', () => {
    const a = playedRich()
    const b = roundTrip(a)
    expect(b.currentPartyJobs).toEqual(a.currentPartyJobs)
    expect(b.party.map((c) => c.id)).toEqual(a.party.map((c) => c.id))
  })

  it('사람마다 다른 장비가 제 주인에게 그대로 온다', () => {
    const a = playedRich()
    const b = roundTrip(a)
    for (const c of a.party) {
      expect(b.equipmentOf(c.id), c.id).toEqual(a.equipmentOf(c.id))
    }
    // 전용 무기가 섞이지 않았는지 — 이름까지 확인한다
    expect(b.equipmentOf('archer').weapon).toBe('wood_bow')
    expect(b.equipmentOf('mage').weapon).toBe('wood_staff')
    expect(b.equipmentOf('warrior').weapon).toBe('heavy_club')
  })

  it('사람마다 다른 강화 단계가 그대로 온다', () => {
    const a = playedRich()
    const b = roundTrip(a)
    for (const c of a.party) {
      for (const stat of a.upgradeStats) {
        expect(b.upgradeLevelOf(c.id, stat), `${c.id}.${stat}`).toBe(a.upgradeLevelOf(c.id, stat))
      }
    }
    expect(b.upgradeLevelOf('archer', 'atk')).toBe(2)
    expect(b.upgradeLevelOf('mage', 'spd')).toBe(1)
    expect(b.upgradeLevelOf('warrior', 'hp')).toBe(1)
  })

  it('능력치가 같은 수로 다시 계산된다 — 장비·강화·특성이 다 반영된 결과로', () => {
    const a = playedRich()
    const b = roundTrip(a)
    for (const c of a.party) {
      const x = a.statBreakdownOf(c.id)!
      const y = b.statBreakdownOf(c.id)!
      expect(y.total, c.id).toEqual(x.total)
      expect(y.equip, `${c.id} 장비분`).toEqual(x.equip)
      expect(y.upgrade, `${c.id} 강화분`).toEqual(x.upgrade)
    }
  })

  it('지갑·가방·처치 수·특성·클리어 기록이 그대로 온다', () => {
    const a = playedRich()
    const b = roundTrip(a)
    expect(b.currentGold).toBe(a.currentGold)
    expect(b.currentMaterials).toBe(a.currentMaterials)
    expect(b.inventoryList).toEqual(a.inventoryList)
    expect(b.currentTraitId).toBe(a.currentTraitId)
    expect(b.clearedStageIds).toEqual(a.clearedStageIds)
    expect(b.snapshot().kills).toEqual(a.snapshot().kills)
  })

  it('두 번 왕복해도 값이 흔들리지 않는다', () => {
    const a = playedRich()
    const once = roundTrip(a)
    const twice = roundTrip(once)
    expect(twice.snapshot()).toEqual(once.snapshot())
  })
})
