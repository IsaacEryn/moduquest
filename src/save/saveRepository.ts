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
  /**
   * 저장이 막혔다고 이미 알렸는가. 걸음마다 같은 말을 반복하면 안내가 소음이 되고,
   * 한 번도 안 알리면 스테이지를 다 걷고 나서야 잃은 것을 안다. 그래서 한 번만 알린다.
   */
  private warned = false

  constructor(
    private data: GameData,
    /** 기록에 실패했다 — 저장 버튼이 없는 게임이므로 이 사실은 반드시 도달해야 한다 */
    private onWriteFailed: (reason: string) => void = () => {},
  ) {}

  /** 손대지 않은 날것. 쓰기는 다른 칸을 그대로 두어야 하므로 검증하지 않는다 */
  private readRaw(): unknown[] {
    const empty = Array.from({ length: SLOT_COUNT }, () => null as unknown)
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return empty
      const parsed = JSON.parse(raw) as { slots?: unknown[] }
      if (!Array.isArray(parsed.slots)) return empty
      return empty.map((_, i) => parsed.slots?.[i] ?? null)
    } catch {
      return empty
    }
  }

  /**
   * 읽을 때에만 검증한다. 예전에는 한 칸을 쓸 때마다 세 칸을 전부 검증해 다시 썼는데,
   * 걸음마다 일어나는 일치고는 비싸고, 다른 칸이 조용히 다시 쓰이는 부작용도 있었다.
   */
  private readAll(): (SaveSnapshot | null)[] {
    return this.readRaw().map((s) => sanitizeSnapshot(s, this.data))
  }

  private writeAll(slots: unknown[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ slots }))
      this.warned = false
    } catch {
      // 저장 공간이 막혀도 게임은 계속돼야 한다. 다만 조용히는 아니다 —
      // 저장 버튼이 없으니 알려주지 않으면 걷는 동안 잃고 있는 줄을 모른다
      if (this.warned) return
      this.warned = true
      this.onWriteFailed(
        '기록을 남기지 못했다. 브라우저의 저장 공간이 막혀 있는지 확인하자. ' +
          '지금 하는 모험은 계속할 수 있지만 이어서 하기로는 남지 않는다.',
      )
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
    const slots = this.readRaw()
    slots[slot] = snapshot
    this.writeAll(slots)
  }

  async remove(slot: number): Promise<void> {
    if (!isValidSlot(slot)) return
    const slots = this.readRaw()
    slots[slot] = null
    this.writeAll(slots)
  }
}
