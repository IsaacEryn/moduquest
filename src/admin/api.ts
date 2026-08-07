import { supabase } from '../net/supabaseClient'

/**
 * 서버 창구 — 관리자 화면의 모든 읽기·쓰기가 여기를 지난다.
 * 권한은 전부 서버(RLS·RPC)가 판정한다. 여기서는 묻고, 기록하고, 전달만 한다.
 */

export interface ProfileRow {
  user_id: string
  nickname: string
  friend_code: string
  created_at: string
  role: string
  banned_until: string | null
}

export const PAGE = 50

export async function fetchStats(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase().rpc('admin_stats')
  if (error) throw new Error('통계를 불러오지 못했다.')
  return data as Record<string, unknown>
}

export async function fetchProfiles(page: number, search: string): Promise<ProfileRow[]> {
  let q = supabase()
    .from('profiles')
    .select('user_id, nickname, friend_code, created_at, role, banned_until')
    .order('created_at', { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1)
  if (search) {
    // 8자 대문자면 친구 코드, 아니면 닉네임 검색으로 읽는다
    q = /^[A-Z0-9]{8}$/.test(search.toUpperCase())
      ? q.eq('friend_code', search.toUpperCase())
      : q.ilike('nickname', `%${search}%`)
  }
  const { data, error } = await q
  if (error) throw new Error('사용자 목록을 불러오지 못했다.')
  return (data ?? []) as ProfileRow[]
}

/** 최근 저장 활동 — snapshot은 절대 가져오지 않는다 (행마다 최대 64KB) */
export async function fetchSaveActivity(): Promise<{ user_id: string; updated_at: string }[]> {
  const { data } = await supabase()
    .from('user_saves')
    .select('user_id, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500)
  return data ?? []
}

/** user_id → 닉네임 맵. 로그 표가 uuid 대신 이름을 보여주기 위한 것 */
export async function nicknameMap(): Promise<Map<string, string>> {
  const { data } = await supabase().from('profiles').select('user_id, nickname')
  return new Map((data ?? []).map((r) => [r.user_id as string, r.nickname as string]))
}

/** 감사 로그를 남긴다 — 조치 함수들이 반드시 이것과 짝으로 움직인다 */
async function audit(
  actor: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await supabase().from('admin_audit').insert({ actor, action, target, detail: detail ?? null })
}

/** 닉네임 초기화 — 사칭·부적절 닉네임을 익명 꼴로 되돌린다 */
export async function resetNickname(actor: string, row: ProfileRow): Promise<void> {
  const fresh = `모험가${row.friend_code.slice(0, 4)}`
  const { error, data } = await supabase()
    .from('profiles')
    .update({ nickname: fresh })
    .eq('user_id', row.user_id)
    .select('user_id')
  if (error || (data?.length ?? 0) === 0) throw new Error('닉네임을 바꾸지 못했다.')
  await audit(actor, 'nickname_reset', row.user_id, { from: row.nickname, to: fresh })
}

/** 멀티 이용 정지 — days가 null이면 해제 */
export async function setBan(actor: string, row: ProfileRow, days: number | null): Promise<void> {
  const until = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString()
  const { error, data } = await supabase()
    .from('profiles')
    .update({ banned_until: until })
    .eq('user_id', row.user_id)
    .select('user_id')
  if (error || (data?.length ?? 0) === 0) throw new Error('정지 설정을 바꾸지 못했다.')
  await audit(actor, days === null ? 'unban' : 'ban', row.user_id, { days, until })
}

/** 계정 삭제 — 서버 전용 열쇠가 필요한 유일한 일이라 서버 함수를 부른다 */
export async function deleteUser(target: string): Promise<void> {
  const { data, error } = await supabase().functions.invoke('admin-delete-user', {
    body: { target },
  })
  if (error || !(data as { ok?: boolean })?.ok) {
    throw new Error('계정을 지우지 못했다. 서버 함수가 배포돼 있는지 확인하자.')
  }
}

/** 이메일 조회 — 호출 자체가 감사 로그에 남는다(RPC가 기록) */
export async function lookupEmail(target: string): Promise<string> {
  const { data, error } = await supabase().rpc('admin_get_email', { target })
  if (error) throw new Error('이메일을 조회하지 못했다.')
  return (data as string) ?? '(없음)'
}

/** 감사 로그 읽기 */
export async function fetchAudit(page: number): Promise<Record<string, unknown>[]> {
  const { data } = await supabase()
    .from('admin_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1)
  return data ?? []
}

/** 로그 탭들의 공통 읽기 — 테이블·컬럼만 다르고 페이지 방식은 같다 */
export async function fetchLog(
  table: 'gifts' | 'friendships' | 'party_invites' | 'user_saves',
  columns: string,
  orderCol: string,
  page: number,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase()
    .from(table)
    .select(columns)
    .order(orderCol, { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1)
  if (error) throw new Error('기록을 불러오지 못했다.')
  return (data ?? []) as unknown as Record<string, unknown>[]
}
