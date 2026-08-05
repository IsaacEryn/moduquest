import { describe, expect, it } from 'vitest'
import { EventBus } from './events'
import { Game } from './game'
import { SAVE_VERSION, progressScore, sanitizeSnapshot } from './save'
import type { GameData, SaveSnapshot, StageData, TraitsFile } from './types'
import items from '../data/items.json'
import sets from '../data/sets.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
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
  stages: [stage1, stage2, stage3] as StageData[],
  traits: traitsFile as TraitsFile,
}

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
    expect(snapshot.field.openedChests).toEqual(['t1'])
    expect(snapshot.inventory).toEqual([{ item: 'potion_small', count: 1 }])

    const b = makeGame()
    b.restore(snapshot)
    expect(b.inventoryList[0]).toMatchObject({ id: 'potion_small', count: 1 })
    expect(b.field.openedChestIds).toEqual(['t1']) // 되살아나지 않는다
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
    expect(outside?.field.pos).toEqual(stage1.map.start)

    const onWall = sanitizeSnapshot(
      { ...valid(), field: { ...valid().field, pos: { x: 0, y: 0 } } },
      DATA,
    )
    expect(onWall?.field.pos).toEqual(stage1.map.start)
  })

  it('없는 조우·대사 키는 버린다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        field: { ...valid().field, defeated: ['e1', '없는조우', 'e1'] },
        seenDialogues: ['intro', '없는대사'],
        clearedStages: ['stage1', '없는스테이지'],
      },
      DATA,
    )
    expect(s?.field.defeated).toEqual(['e1']) // 중복도 정리된다
    expect(s?.seenDialogues).toEqual(['intro'])
    expect(s?.clearedStages).toEqual(['stage1'])
  })

  it('파티 구성이 깨져 있으면 기본 구성으로 되돌린다', () => {
    // 없는 직업이 섞이거나 정원이 모자라면 구성 전체를 기본값으로
    const broken = sanitizeSnapshot(
      { ...valid(), party: [{ job: 'rogue', hp: 10 }, { job: '없는직업', hp: 10 }] },
      DATA,
    )
    expect(broken?.party.map((p) => p.job)).toEqual(['rogue', 'warrior', 'healer'])

    const dup = sanitizeSnapshot(
      {
        ...valid(),
        party: [
          { job: 'healer', hp: 10 },
          { job: 'healer', hp: 10 },
          { job: 'rogue', hp: 10 },
        ],
      },
      DATA,
    )
    expect(dup?.party.map((p) => p.job)).toEqual(['rogue', 'warrior', 'healer'])
  })

  it('바꾼 파티 구성은 그대로 저장되고 복원된다', () => {
    const s = sanitizeSnapshot(
      {
        ...valid(),
        party: [
          { job: 'mage', hp: 40 },
          { job: 'archer', hp: 50 },
          { job: 'healer', hp: 60 },
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
        field: { ...valid().field, openedChests: ['t1', '없는상자', 't1'] },
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
    expect(s?.field.openedChests).toEqual(['t1'])
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
          { job: 'warrior', hp: 120 },
          { job: 'healer', hp: 80 },
        ],
      },
      DATA,
    )
    expect(s?.party[0].hp).toBe(0)
  })

  it('v1 기록은 버리지 않고 살려서 읽는다', () => {
    // 옛 형식: party가 {id, hp}이고 xp가 없다
    const v1 = {
      schemaVersion: 1,
      stageIndex: 1,
      traitId: 'swift-step',
      field: { pos: { x: 1, y: 8 }, checkpointReached: true, defeated: [] },
      party: [
        { id: 'rogue', hp: 44 },
        { id: 'warrior', hp: 100 },
        { id: 'healer', hp: 70 },
      ],
      seenDialogues: [],
      clearedStages: ['stage1'],
      updatedAt: 500,
    }
    const s = sanitizeSnapshot(v1, DATA)
    expect(s).not.toBeNull()
    expect(s?.schemaVersion).toBe(SAVE_VERSION)
    expect(s?.party.map((p) => p.job)).toEqual(['rogue', 'warrior', 'healer'])
    expect(s?.party[0].hp).toBe(44)
    // 스테이지 2 진행이었으니 그에 걸맞은 경험치를 보장받는다
    expect(s?.xp).toBe(DATA.progression.stageEntryXp[1])
  })

  it('복원할 때 체력이 최대치를 넘지 않는다', () => {
    const g = makeGame()
    g.restore({ ...valid(), party: [{ job: 'rogue', hp: 9999 }] })
    expect(g.player.hp).toBe(g.player.maxHp)
  })

  it('필드가 통째로 빠져 있어도 죽지 않는다', () => {
    const { field: _f, ...rest } = valid()
    const s = sanitizeSnapshot(rest, DATA)
    expect(s?.field.pos).toEqual(stage1.map.start)
    expect(s?.field.defeated).toEqual([])
  })

  it('버전은 항상 지금 버전으로 맞춰 나온다', () => {
    expect(sanitizeSnapshot(valid(), DATA)?.schemaVersion).toBe(SAVE_VERSION)
  })
})
