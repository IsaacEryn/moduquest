import { lookupFriend } from './gifts'
import { supabase } from './supabaseClient'

/**
 * 친구 — 서로 동의한 사이.
 *
 * 신청은 한 방향이고 수락해야 친구가 된다. 목록에 있다는 것은 두 사람 다
 * 허락했다는 뜻이라, 초대 코드를 부르지 않고도 모험단에 부를 수 있다.
 * 초대는 코드를 실은 쪽지(party_invites)로 간다 — 받는 쪽 홈 화면에 떠서
 * 한 번 눌러 참가한다.
 */

export interface FriendEntry {
  userId: string
  nickname: string
}

export interface FriendState {
  /** 서로 수락한 사이 */
  friends: FriendEntry[]
  /** 내게 온 신청 — 수락하거나 거절한다 */
  incoming: FriendEntry[]
  /** 내가 보낸 신청 — 상대의 대답을 기다린다 */
  outgoing: FriendEntry[]
}

async function myId(): Promise<string | null> {
  const { data } = await supabase().auth.getSession()
  return data.session?.user.id ?? null
}

export type FriendRow = {
  requester: string
  addressee: string
  status: string
  from_profile: { nickname?: string } | null
  to_profile: { nickname?: string } | null
}

/**
 * 관계 행을 내 시점의 세 갈래로 갈라 놓는다. 한 행이 신청이자 친구 관계라
 * "누가 청했는가"와 "수락했는가"를 함께 봐야 어느 칸에 놓을지 정해진다.
 * 순수 함수로 둔 것은 이 판단이 화면 문구를 좌우해서다 — 시험으로 못박는다.
 */
export function splitFriendRows(rows: FriendRow[], me: string): FriendState {
  const out: FriendState = { friends: [], incoming: [], outgoing: [] }
  for (const raw of rows) {
    const iAsked = raw.requester === me
    const other: FriendEntry = iAsked
      ? { userId: raw.addressee, nickname: raw.to_profile?.nickname ?? '모험가' }
      : { userId: raw.requester, nickname: raw.from_profile?.nickname ?? '모험가' }
    if (raw.status === 'accepted') out.friends.push(other)
    else if (iAsked) out.outgoing.push(other)
    else out.incoming.push(other)
  }
  return out
}

export async function loadFriends(): Promise<FriendState> {
  const me = await myId()
  const empty: FriendState = { friends: [], incoming: [], outgoing: [] }
  if (!me) return empty
  const { data, error } = await supabase()
    .from('friendships')
    .select(
      'requester, addressee, status, from_profile:profiles!friendships_requester_fkey(nickname), to_profile:profiles!friendships_addressee_fkey(nickname)',
    )
    .order('created_at', { ascending: true })
  // 못 읽은 것을 "친구가 없다"로 보여주면 조용한 거짓말이 된다 — 화면이 다시 시도하게 던진다
  if (error) throw new Error('친구 목록을 불러오지 못했다.')
  if (!data) return empty
  return splitFriendRows(data as unknown as FriendRow[], me)
}

export type AddFriendResult =
  | { kind: 'requested'; nickname: string }
  | { kind: 'accepted'; nickname: string } // 상대가 먼저 청해 두었다 — 바로 친구가 됐다
  | { kind: 'already'; nickname: string }
  | { kind: 'not-found' }
  | { kind: 'self' }

/** 친구 코드로 신청한다. 상대의 신청이 이미 와 있으면 그 자리에서 수락이 된다 */
export async function addFriendByCode(code: string): Promise<AddFriendResult> {
  const me = await myId()
  if (!me) return { kind: 'not-found' }
  const target = await lookupFriend(code)
  if (!target) return { kind: 'not-found' }
  if (target.userId === me) return { kind: 'self' }

  const state = await loadFriends()
  if (state.friends.some((f) => f.userId === target.userId)) {
    return { kind: 'already', nickname: target.nickname }
  }
  if (state.incoming.some((f) => f.userId === target.userId)) {
    await acceptFriend(target.userId)
    return { kind: 'accepted', nickname: target.nickname }
  }
  if (state.outgoing.some((f) => f.userId === target.userId)) {
    return { kind: 'already', nickname: target.nickname }
  }

  const { error } = await supabase()
    .from('friendships')
    .insert({ requester: me, addressee: target.userId })
  if (error) {
    // 방향만 다른 행이 이미 있으면(동시에 서로 청한 경우) 겹침 제약에 걸린다
    if (error.message.includes('duplicate') || error.message.includes('friendships_pair')) {
      return { kind: 'already', nickname: target.nickname }
    }
    throw new Error('친구 신청을 보내지 못했다. 잠시 뒤에 다시.')
  }
  return { kind: 'requested', nickname: target.nickname }
}

export async function acceptFriend(requesterId: string): Promise<boolean> {
  const me = await myId()
  if (!me) return false
  const { data, error } = await supabase()
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester', requesterId)
    .eq('addressee', me)
    .eq('status', 'pending')
    .select('requester')
  return !error && (data?.length ?? 0) > 0
}

/** 신청 거절·취소·친구 삭제 — 전부 관계 행을 지우는 한 가지 일이다 */
export async function removeFriendship(otherId: string): Promise<void> {
  const me = await myId()
  if (!me) return
  await supabase()
    .from('friendships')
    .delete()
    .or(
      `and(requester.eq.${me},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${me})`,
    )
}

// --- 모험단 초대 쪽지 ---

export interface PartyInvite {
  id: string
  fromNickname: string
  code: string
}

/** 이 시간이 지난 쪽지는 보여주지 않는다 — 어제의 모험단은 이미 없다 */
const INVITE_FRESH_MS = 30 * 60 * 1000

export async function sendPartyInvite(toUserId: string, code: string): Promise<void> {
  const me = await myId()
  if (!me) throw new Error('로그인이 필요하다.')
  const { error } = await supabase()
    .from('party_invites')
    .insert({ from_user: me, to_user: toUserId, code })
  if (error) {
    if (error.message.includes('daily invite limit')) {
      throw new Error('오늘 보낼 수 있는 초대를 다 보냈다. 내일 다시.')
    }
    throw new Error('초대를 보내지 못했다. 잠시 뒤에 다시.')
  }
}

export async function listPartyInvites(): Promise<PartyInvite[]> {
  const me = await myId()
  if (!me) return []
  const since = new Date(Date.now() - INVITE_FRESH_MS).toISOString()
  const { data, error } = await supabase()
    .from('party_invites')
    .select('id, code, created_at, profiles!party_invites_from_user_fkey(nickname)')
    .eq('to_user', me)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw new Error('받은 초대를 불러오지 못했다.')
  if (!data) return []
  return data.map((row) => ({
    id: row.id as string,
    code: row.code as string,
    fromNickname:
      (row.profiles as unknown as { nickname?: string } | null)?.nickname ?? '모험가',
  }))
}

export async function deletePartyInvite(id: string): Promise<void> {
  await supabase().from('party_invites').delete().eq('id', id)
}

/**
 * 친구 관계와 받은 초대가 바뀌면 알려 준다.
 *
 * 예전에는 창을 닫았다 다시 열어야 바뀐 것이 보였다. 친구 신청은 상대가 수락하는
 * 순간 관계가 서는 일이고 초대는 "지금 같이 걷자"는 부름인데, 그것을 보려고
 * 창을 여닫아야 한다면 이미 늦은 소식이다.
 *
 * 무엇이 바뀌었는지는 굳이 캐지 않고 "바뀌었다"만 전한다 — 받는 쪽이 목록을
 * 다시 읽으면 그것이 곧 진실이고, 정책이 이미 내 것만 보내 주므로 남의 변화로
 * 헛되이 다시 읽는 일도 없다.
 *
 * 돌려주는 함수를 부르면 구독을 끊는다. 창이 닫힐 때 반드시 부른다.
 */
export function watchFriendActivity(onChange: (what: 'friends' | 'invites') => void): () => void {
  const sb = supabase()
  const channel = sb
    .channel('friend-activity')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friendships' },
      () => onChange('friends'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'party_invites' },
      () => onChange('invites'),
    )
    .subscribe()
  return () => {
    void sb.removeChannel(channel)
  }
}
