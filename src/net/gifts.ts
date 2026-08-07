import type { GameData, SaveSnapshot } from '../core/types'
import { supabase } from './supabaseClient'

/**
 * 계정 사이의 선물. 실시간 세션과 무관한 비동기 우편이다 —
 * 보낸 것은 상대가 받기를 누를 때에야 실물이 된다.
 *
 * 차감과 지급이 클라이언트에서 일어나므로 어긋나면 아이템이 "사라지는"
 * 방향으로만 어긋난다(복제는 안 된다). 남용은 서버의 하루 상한이 막는다.
 */

export interface GiftRow {
  id: string
  fromUser: string
  toUser: string
  itemId: string
  qty: number
  messageId: string | null
  fromNickname: string
}

export const GIFT_MESSAGES: Record<string, string> = {
  thanks: '고마워!',
  together: '같이 가자.',
  gift: '선물이야.',
  cheer: '힘내!',
}

/**
 * 선물할 수 있는 물건인가 — 팔 수 있는 것과 같은 기준을 쓴다.
 * 추억의 물건과 일행을 비추는 오라 장비는 남에게도 넘길 수 없다.
 */
export function giftableReason(itemId: string, data: GameData): { ok: boolean; reason?: string } {
  const item = data.items[itemId]
  if (!item) return { ok: false, reason: '알 수 없는 물건이다.' }
  if (item.kind === 'keepsake') return { ok: false, reason: '추억의 물건은 손에서 놓을 수 없다.' }
  if (item.kind === 'equipment') {
    if (item.allyStats) return { ok: false, reason: '일행을 비추는 물건은 손에서 놓을 수 없다.' }
    if (!item.tier) return { ok: false, reason: '이 물건은 보낼 수 없다.' }
  }
  return { ok: true }
}

/** 친구 코드로 상대를 찾는다 — 닉네임만 돌아온다 */
export async function lookupFriend(
  code: string,
): Promise<{ userId: string; nickname: string } | null> {
  const trimmed = code.trim().toUpperCase()
  if (trimmed.length !== 8) return null
  const { data } = await supabase()
    .from('profiles')
    .select('user_id, nickname')
    .eq('friend_code', trimmed)
    .maybeSingle()
  if (!data) return null
  return { userId: data.user_id as string, nickname: (data.nickname as string) ?? '' }
}

export async function sendGift(
  toUser: string,
  itemId: string,
  messageId: string | null,
): Promise<void> {
  const { error } = await supabase().from('gifts').insert({
    from_user: (await supabase().auth.getSession()).data.session?.user.id,
    to_user: toUser,
    item_id: itemId,
    qty: 1,
    message_id: messageId,
  })
  if (error) {
    if (error.message.includes('daily gift limit')) {
      throw new Error('오늘 보낼 수 있는 선물을 다 보냈다. 내일 다시.')
    }
    throw new Error('선물을 보내지 못했다. 잠시 뒤에 다시.')
  }
}

/** 내게 온, 아직 받지 않은 선물들 */
export async function listIncoming(): Promise<GiftRow[]> {
  const sb = supabase()
  const me = (await sb.auth.getSession()).data.session?.user.id
  if (!me) return []
  const { data } = await sb
    .from('gifts')
    .select('id, from_user, to_user, item_id, qty, message_id, profiles!gifts_from_user_fkey(nickname)')
    .eq('to_user', me)
    .eq('status', 'sent')
    .order('created_at', { ascending: true })
  if (!data) return []
  return data.map((row) => ({
    id: row.id as string,
    fromUser: row.from_user as string,
    toUser: row.to_user as string,
    itemId: row.item_id as string,
    qty: typeof row.qty === 'number' ? row.qty : 1,
    messageId: (row.message_id as string) ?? null,
    fromNickname:
      (row.profiles as unknown as { nickname?: string } | null)?.nickname ?? '누군가',
  }))
}

/** 받기 확정 — 서버가 한 번만 허용한다(두 번 누르면 두 번째는 실패) */
export async function claimGift(id: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from('gifts')
    .update({ status: 'claimed' })
    .eq('id', id)
    .eq('status', 'sent')
    .select('id')
  if (error) return false
  return (data?.length ?? 0) > 0
}

/** 스냅샷의 가방에 물건을 더한다 — 상한 99를 넘기지 않는다 */
export function addToSnapshot(
  snapshot: SaveSnapshot,
  itemId: string,
  qty: number,
): { ok: boolean; reason?: string } {
  // 선물은 0번 자리 가방으로 간다. 저장 기록을 다시 불러오는 자리가 거기이고,
  // 기록 자체에는 "이 사람이 몇 번 자리로 놀았는지"가 남아 있지 않다
  const bag = snapshot.bags[0] ?? (snapshot.bags[0] = [])
  const entry = bag.find((e) => e.item === itemId)
  const current = entry?.count ?? 0
  if (current + qty > 99) return { ok: false, reason: '가방에 이 물건이 이미 가득하다.' }
  if (entry) entry.count = current + qty
  else bag.push({ item: itemId, count: qty })
  return { ok: true }
}

/** 스냅샷의 가방에서 물건 하나를 뺀다 */
export function removeFromSnapshot(snapshot: SaveSnapshot, itemId: string): boolean {
  // 보내는 쪽도 0번 자리 가방에서 뺀다 — 넣는 쪽과 같은 자리여야 왕복이 어긋나지 않는다
  const bag = snapshot.bags[0]
  const entry = bag?.find((e) => e.item === itemId)
  if (!entry || entry.count <= 0) return false
  entry.count -= 1
  if (entry.count === 0) {
    snapshot.bags[0] = bag.filter((e) => e !== entry)
  }
  return true
}
