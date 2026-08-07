import { describe, expect, it } from 'vitest'
import { SLOT_COUNT } from '../core/save'
import type { SaveSnapshot, SlotSummary } from '../core/types'
import { type SaveRepository, isValidSlot, summarize } from './saveRepository'

/**
 * 메모리에만 사는 구현. 클라우드 저장이 붙을 때 같은 시나리오를 그대로
 * 돌려 볼 수 있도록 인터페이스 수준에서 테스트한다.
 */
class MemoryRepository implements SaveRepository {
  private slots: (SaveSnapshot | null)[] = Array.from({ length: SLOT_COUNT }, () => null)

  async list(): Promise<SlotSummary[]> {
    return this.slots.map((s, i) => summarize(i, s))
  }
  async load(slot: number): Promise<SaveSnapshot | null> {
    return isValidSlot(slot) ? this.slots[slot] : null
  }
  async save(slot: number, snapshot: SaveSnapshot): Promise<void> {
    if (isValidSlot(slot)) this.slots[slot] = snapshot
  }
  async remove(slot: number): Promise<void> {
    if (isValidSlot(slot)) this.slots[slot] = null
  }
}

function snapshot(stageIndex = 0, defeated: string[] = []): SaveSnapshot {
  return {
    schemaVersion: 1,
    stageIndex,
    traitIds: ['balanced', 'balanced', 'balanced'],
    layoutKey: 0,
    variants: [],
    field: {
      areaId: 'a',
      pos: { x: 1, y: 8 },
      enteredFrom: null,
      checkpointReached: false,
      defeated,
      openedChests: [],
    },
    inventory: [],
    kills: [],
    party: [{ job: 'rogue', hp: 90, equipment: {} }, { job: 'warrior', hp: 120, equipment: {} }, { job: 'healer', hp: 80, equipment: {} }],
    xp: 0,
    gold: 0,
    materials: 0,
    upgrades: [],
    seenDialogues: [],
    clearedStages: [],
    updatedAt: 1000,
  }
}

describe('슬롯 번호', () => {
  it('세 자리만 쓴다', () => {
    expect(isValidSlot(0)).toBe(true)
    expect(isValidSlot(2)).toBe(true)
    expect(isValidSlot(3)).toBe(false)
    expect(isValidSlot(-1)).toBe(false)
    expect(isValidSlot(1.5)).toBe(false)
  })
})

describe('저장 자리', () => {
  it('처음에는 세 칸 모두 비어 있다', async () => {
    const repo = new MemoryRepository()
    const slots = await repo.list()
    expect(slots).toHaveLength(SLOT_COUNT)
    expect(slots.every((s) => s.empty)).toBe(true)
  })

  it('저장하면 그 칸만 채워진다', async () => {
    const repo = new MemoryRepository()
    await repo.save(1, snapshot(1))
    const slots = await repo.list()
    expect(slots[0].empty).toBe(true)
    expect(slots[1]).toMatchObject({ empty: false, stageIndex: 1, traitId: 'balanced' })
    expect(slots[2].empty).toBe(true)
  })

  it('같은 칸에 저장하면 덮어쓴다', async () => {
    const repo = new MemoryRepository()
    await repo.save(0, snapshot(0))
    await repo.save(0, snapshot(2))
    expect((await repo.load(0))?.stageIndex).toBe(2)
  })

  it('한 칸을 지워도 다른 칸은 남는다', async () => {
    const repo = new MemoryRepository()
    await repo.save(0, snapshot(0))
    await repo.save(1, snapshot(1))
    await repo.save(2, snapshot(2))

    await repo.remove(1)

    const slots = await repo.list()
    expect(slots[0].empty).toBe(false)
    expect(slots[1].empty).toBe(true)
    expect(slots[2].empty).toBe(false)
    expect(await repo.load(1)).toBeNull()
    expect((await repo.load(2))?.stageIndex).toBe(2)
  })

  it('범위 밖 자리는 읽지도 쓰지도 않는다', async () => {
    const repo = new MemoryRepository()
    await repo.save(9, snapshot(0))
    expect(await repo.load(9)).toBeNull()
    expect((await repo.list()).every((s) => s.empty)).toBe(true)
  })

  it('요약에 진행도가 담긴다 — 나중에 어느 기록이 더 나아갔는지 비교할 값이다', () => {
    const far = summarize(0, snapshot(2, ['e1', 'e2']))
    const near = summarize(1, snapshot(0))
    expect(far.progress!).toBeGreaterThan(near.progress!)
  })
})
