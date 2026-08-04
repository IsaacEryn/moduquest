import { SLOT_COUNT, progressScore } from '../core/save'
import type { GameData, SaveSnapshot, SlotSummary } from '../core/types'
import { sanitizeSnapshot } from '../core/save'

/**
 * 저장 자리 세 칸. 화면은 이 인터페이스만 알기 때문에,
 * 나중에 클라우드 저장이 붙어도 사용자가 겪는 흐름은 그대로다 —
 * 바뀌는 것은 기록이 어디에 사는가뿐이다.
 */
export interface SaveRepository {
  list(): Promise<SlotSummary[]>
  load(slot: number): Promise<SaveSnapshot | null>
  save(slot: number, snapshot: SaveSnapshot): Promise<void>
  remove(slot: number): Promise<void>
}

export const isValidSlot = (slot: number) =>
  Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT

export function summarize(slot: number, s: SaveSnapshot | null): SlotSummary {
  if (!s) return { slot, empty: true }
  return {
    slot,
    empty: false,
    stageIndex: s.stageIndex,
    traitId: s.traitId,
    progress: progressScore(s),
    updatedAt: s.updatedAt,
  }
}

const KEY = 'moduquest-saves'

/** 세 칸을 한 덩어리로 읽고 쓴다 — 한 번의 쓰기라 중간에 깨질 자리가 없다 */
export class LocalSaveRepository implements SaveRepository {
  constructor(private data: GameData) {}

  private readAll(): (SaveSnapshot | null)[] {
    const empty = Array.from({ length: SLOT_COUNT }, () => null)
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return empty
      const parsed = JSON.parse(raw) as { slots?: unknown[] }
      if (!Array.isArray(parsed.slots)) return empty
      return empty.map((_, i) => sanitizeSnapshot(parsed.slots?.[i], this.data))
    } catch {
      return empty
    }
  }

  private writeAll(slots: (SaveSnapshot | null)[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ slots }))
    } catch {
      // 저장 공간이 막혀도 게임은 계속돼야 한다
    }
  }

  async list(): Promise<SlotSummary[]> {
    return this.readAll().map((s, i) => summarize(i, s))
  }

  async load(slot: number): Promise<SaveSnapshot | null> {
    if (!isValidSlot(slot)) return null
    return this.readAll()[slot]
  }

  async save(slot: number, snapshot: SaveSnapshot): Promise<void> {
    if (!isValidSlot(slot)) return
    const slots = this.readAll()
    slots[slot] = snapshot
    this.writeAll(slots)
  }

  async remove(slot: number): Promise<void> {
    if (!isValidSlot(slot)) return
    const slots = this.readAll()
    slots[slot] = null
    this.writeAll(slots)
  }
}
