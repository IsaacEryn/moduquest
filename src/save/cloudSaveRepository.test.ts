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
import { EventBus } from '../core/events'
import { Game, type TurnScheduler } from '../core/game'
import { SAVE_VERSION } from '../core/save'
import type { GameData, SaveSnapshot, StageData, TraitsFile } from '../core/types'
import { CloudSaveRepository, type SaveTable } from './cloudSaveRepository'
import { SwitchableSaveRepository, type SaveRepository } from './saveRepository'

/**
 * 계정에 붙는 저장 자리. 서버 없이 왕복을 돌려 보려고 SaveTable만 가짜로 세운다 —
 * 함께 하기의 PartyChannel과 같은 이음매다.
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

function fakeTable() {
  const rows = new Map<string, unknown>()
  let failWrites = false
  let failReads = false
  const table: SaveTable = {
    async readAll(userId) {
      if (failReads) throw new Error('연결 없음')
      return [...rows.entries()]
        .filter(([k]) => k.startsWith(`${userId}:`))
        .map(([k, snapshot]) => ({ slot: Number(k.split(':')[1]), snapshot }))
    },
    async write(userId, slot, snapshot) {
      if (failWrites) throw new Error('연결 없음')
      rows.set(`${userId}:${slot}`, snapshot)
    },
    async erase(userId, slot) {
      rows.delete(`${userId}:${slot}`)
    },
  }
  return {
    table,
    rows,
    breakWrites: () => (failWrites = true),
    fixWrites: () => (failWrites = false),
    breakReads: () => (failReads = true),
  }
}

function makeSnapshot(): SaveSnapshot {
  const scheduler: TurnScheduler = { schedule: () => 1, cancel: () => {} }
  const game = new Game(DATA, new EventBus(), scheduler)
  game.start()
  return game.snapshot()
}

describe('계정 저장 자리', () => {
  it('저장한 것을 그대로 되읽는다', async () => {
    const fake = fakeTable()
    const repo = new CloudSaveRepository('me', DATA, () => {}, fake.table)
    const snap = makeSnapshot()
    await repo.save(1, snap)

    const loaded = await repo.load(1)
    expect(loaded?.stageIndex).toBe(snap.stageIndex)
    expect(loaded?.schemaVersion).toBe(SAVE_VERSION)
    const list = await repo.list()
    expect(list.map((s) => s.empty)).toEqual([true, false, true])
  })

  it('지우면 그 자리만 빈다', async () => {
    const fake = fakeTable()
    const repo = new CloudSaveRepository('me', DATA, () => {}, fake.table)
    await repo.save(0, makeSnapshot())
    await repo.save(2, makeSnapshot())
    await repo.remove(0)
    expect((await repo.list()).map((s) => s.empty)).toEqual([true, true, false])
  })

  it('남의 자리는 보이지 않는다', async () => {
    const fake = fakeTable()
    const mine = new CloudSaveRepository('me', DATA, () => {}, fake.table)
    const other = new CloudSaveRepository('other', DATA, () => {}, fake.table)
    await other.save(0, makeSnapshot())
    expect((await mine.list()).every((s) => s.empty)).toBe(true)
  })

  it('서버에서 온 값도 검증을 지난다 — 손상된 행은 빈 자리가 된다', async () => {
    const fake = fakeTable()
    const repo = new CloudSaveRepository('me', DATA, () => {}, fake.table)
    fake.rows.set('me:0', { schemaVersion: 9999, junk: true })
    expect((await repo.list())[0].empty).toBe(true)
  })

  it('읽지 못하면 빈 것처럼 답하지 않고 던진다', async () => {
    // 비어 있다고 답하면 그 자리에 새로 시작할 수 있게 되고,
    // 그 순간 서버의 진짜 기록을 덮어쓴다
    const fake = fakeTable()
    const repo = new CloudSaveRepository('me', DATA, () => {}, fake.table)
    await repo.save(0, makeSnapshot())
    fake.breakReads()
    await expect(repo.list()).rejects.toThrow()
    await expect(repo.load(0)).rejects.toThrow()
  })

  it('쓰기 실패는 게임을 멈추지 않되 한 번은 알린다', async () => {
    const fake = fakeTable()
    const said: string[] = []
    const repo = new CloudSaveRepository('me', DATA, (r) => said.push(r), fake.table)
    fake.breakWrites()
    await repo.save(0, makeSnapshot())
    await repo.save(0, makeSnapshot())
    await repo.save(0, makeSnapshot())
    expect(said).toHaveLength(1) // 걸음마다 같은 말을 반복하지 않는다
    expect(said[0]).toContain('계정에 남기지 못했다')

    // 다시 통하면 다음 실패는 새로 알린다
    fake.fixWrites()
    await repo.save(0, makeSnapshot())
    fake.breakWrites()
    await repo.save(0, makeSnapshot())
    expect(said).toHaveLength(2)
  })
})

describe('저장 자리 갈아 끼우기', () => {
  it('안쪽을 바꾸면 그 뒤의 호출이 새 저장소로 간다', async () => {
    const a = fakeTable()
    const b = fakeTable()
    const repoA = new CloudSaveRepository('me', DATA, () => {}, a.table)
    const repoB = new CloudSaveRepository('me', DATA, () => {}, b.table)
    const saves: SaveRepository = new SwitchableSaveRepository(repoA)

    await saves.save(0, makeSnapshot())
    expect((await saves.list())[0].empty).toBe(false)
    ;(saves as SwitchableSaveRepository).inner = repoB
    // 다른 벌이므로 섞이지 않는다 — 싱글과 멀티가 서로 다른 기록이라는 규칙이다
    expect((await saves.list())[0].empty).toBe(true)
  })
})

describe('스냅샷은 서버가 받는 크기 안에 있다', () => {
  it('가장 무거운 기록도 64KB를 넘지 않는다', () => {
    // user_saves에 pg_column_size(snapshot) < 65536 제약이 걸려 있다.
    // 넘으면 저장이 조용히 실패하므로 여유가 있는지 여기서 잰다
    const scheduler: TurnScheduler = { schedule: () => 1, cancel: () => {} }
    const game = new Game(DATA, new EventBus(), scheduler)
    game.start()
    const base = game.snapshot()

    const everyItem = Object.keys(DATA.items).map((item) => ({ item, count: 99 }))
    const everyMonster = Object.keys(DATA.monsters).map((monster) => ({ monster, count: 99999 }))
    const worst: SaveSnapshot = {
      ...base,
      stageIndex: DATA.stages.length - 1,
      inventory: everyItem,
      kills: everyMonster,
      clearedStages: DATA.stages.map((s) => s.id),
      variants: DATA.stages.map((s) => ({ stage: s.id, variant: 1 })),
      seenDialogues: Object.keys(DATA.stages[2].script),
      upgrades: DATA.party.flatMap((p) =>
        DATA.economy.upgrade.stats.map((stat) => ({ job: p.job, stat, level: 3 })),
      ),
      field: {
        ...base.field,
        defeated: DATA.stages.flatMap((s) =>
          s.areas.flatMap((a) => [
            ...a.encounters.map((e) => `${a.id}-${e.id}`),
            ...(a.boss ? [`${a.id}-${a.boss.id}`] : []),
          ]),
        ),
        openedChests: DATA.stages.flatMap((s) =>
          s.areas.flatMap((a) => (a.chests ?? []).map((c) => `${a.id}-${c.id}`)),
        ),
      },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(worst)).length
    expect(bytes, `가장 무거운 스냅샷 ${bytes}바이트`).toBeLessThan(65536)
  })
})
