import { sanitizeSnapshot } from '../core/save'
import type { GameData, SaveSnapshot, SlotSummary } from '../core/types'
import { supabase } from '../net/supabaseClient'
import { isValidSlot, summarize, type SaveRepository } from './saveRepository'

/**
 * 계정에 붙는 저장 자리 세 칸. 기기가 아니라 사람을 따라다니므로, 다른 브라우저에서
 * 로그인해도 같은 기록이 나온다.
 *
 * 이 파일은 supabase를 불러오므로 **반드시 동적 import로만 닿아야 한다.** 정적으로
 * 끌어오면 혼자 하는 실행에도 서버 코드가 딸려 온다 — 그 성질은 이 저장소가 지키기로
 * 한 것이고, 빌드 결과를 검사해 지킨다.
 */

/**
 * 세션이 저장 자리에 바라는 것 전부. Supabase 질의 빌더를 그대로 쓰지 않고 이만큼만
 * 떼어 둔 것은, 시험이 서버 없이 왕복을 돌려볼 수 있게 하기 위해서다 —
 * 함께 하기의 PartyChannel과 같은 이유, 같은 방식이다.
 */
export interface SaveTable {
  /** 이 사람의 모든 자리. 읽지 못하면 던진다 — 빈 것과 못 읽은 것은 다르다 */
  readAll(userId: string): Promise<{ slot: number; snapshot: unknown }[]>
  write(userId: string, slot: number, snapshot: SaveSnapshot): Promise<void>
  erase(userId: string, slot: number): Promise<void>
}

export const supabaseSaveTable: SaveTable = {
  async readAll(userId) {
    const { data, error } = await supabase()
      .from('user_saves')
      .select('slot, snapshot')
      .eq('user_id', userId)
    if (error) throw new Error(error.message)
    return (data ?? []) as { slot: number; snapshot: unknown }[]
  },
  async write(userId, slot, snapshot) {
    const { error } = await supabase()
      .from('user_saves')
      .upsert({ user_id: userId, slot, snapshot, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  },
  async erase(userId, slot) {
    const { error } = await supabase()
      .from('user_saves')
      .delete()
      .eq('user_id', userId)
      .eq('slot', slot)
    if (error) throw new Error(error.message)
  },
}

export class CloudSaveRepository implements SaveRepository {
  /** 저장이 막혔다고 이미 알렸는가 — 로컬 저장소와 같은 규칙으로 한 번만 알린다 */
  private warned = false

  constructor(
    private userId: string,
    private data: GameData,
    /** 기록에 실패했다 — 저장 버튼이 없는 게임이므로 이 사실은 반드시 도달해야 한다 */
    private onWriteFailed: (reason: string) => void = () => {},
    private table: SaveTable = supabaseSaveTable,
  ) {}

  /**
   * 서버에서 온 값도 믿지 않는다. 저장 검증은 게임 데이터를 기준으로 하므로,
   * 옛 버전이나 손상된 행은 여기서 걸러지거나 마이그레이션을 지난다.
   */
  private async readAll(): Promise<(SaveSnapshot | null)[]> {
    const rows = await this.table.readAll(this.userId)
    const slots: (SaveSnapshot | null)[] = [null, null, null]
    for (const row of rows) {
      if (!isValidSlot(row.slot)) continue
      slots[row.slot] = sanitizeSnapshot(row.snapshot, this.data)
    }
    return slots
  }

  /**
   * 읽지 못하면 던진다. 비어 있는 것처럼 답하면 그 자리에 새로 시작할 수 있게 되고,
   * 그 순간 서버의 진짜 기록을 덮어쓴다 — 연결이 잠깐 끊긴 대가치고는 너무 크다.
   */
  async list(): Promise<SlotSummary[]> {
    const slots = await this.readAll()
    return slots.map((s, i) => summarize(i, s))
  }

  async load(slot: number): Promise<SaveSnapshot | null> {
    if (!isValidSlot(slot)) return null
    return (await this.readAll())[slot]
  }

  async save(slot: number, snapshot: SaveSnapshot): Promise<void> {
    if (!isValidSlot(slot)) return
    try {
      await this.table.write(this.userId, slot, snapshot)
      this.warned = false
    } catch {
      // 쓰기는 걸음마다 일어나므로 던지지 않는다. 다만 조용히도 아니다
      if (this.warned) return
      this.warned = true
      this.onWriteFailed(
        '기록을 계정에 남기지 못했다. 연결을 확인하자. ' +
          '지금 하는 모험은 계속할 수 있지만 이어서 하기로는 남지 않는다.',
      )
    }
  }

  /** 지우기는 사람이 청한 일이라 실패를 삼키지 않는다 — 지워졌는지 알아야 한다 */
  async remove(slot: number): Promise<void> {
    if (!isValidSlot(slot)) return
    await this.table.erase(this.userId, slot)
  }
}
