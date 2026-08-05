import { supabase } from './supabaseClient'

export interface Profile {
  userId: string
  nickname: string
  friendCode: string
}

/** 사람이 읽을 한국어 문장으로 바꾼다 — 서버의 영어 오류를 그대로 보이지 않는다 */
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return '이메일이나 비밀번호가 맞지 않다.'
  if (m.includes('already registered')) return '이미 가입된 이메일이다. 로그인해 보자.'
  if (m.includes('password should be')) return '비밀번호는 8자 이상이어야 한다.'
  if (m.includes('valid email')) return '이메일 형태가 아니다.'
  if (m.includes('rate limit') || m.includes('too many')) return '시도가 너무 잦다. 잠시 뒤에 다시.'
  if (m.includes('fetch')) return '서버에 닿지 못했다. 연결을 확인하자.'
  return '요청이 실패했다. 잠시 뒤에 다시 해 보자.'
}

export function validNickname(nick: string): boolean {
  const n = nick.trim()
  return n.length >= 1 && n.length <= 12
}

/** 가입 — 계정을 만들고 닉네임 프로필을 함께 남긴다 */
export async function signUp(email: string, password: string, nickname: string): Promise<Profile> {
  const sb = supabase()
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw new Error(friendly(error.message))
  const user = data.user
  if (!user) throw new Error('가입이 접수됐지만 확인이 필요하다. 메일함을 확인하자.')
  const { error: pErr } = await sb
    .from('profiles')
    .insert({ user_id: user.id, nickname: nickname.trim() })
  if (pErr && !pErr.message.includes('duplicate')) throw new Error(friendly(pErr.message))
  return (await currentProfile()) ?? { userId: user.id, nickname: nickname.trim(), friendCode: '' }
}

export async function signIn(email: string, password: string): Promise<Profile> {
  const sb = supabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(friendly(error.message))
  const profile = await currentProfile()
  if (profile) return profile
  // 가입 때 프로필이 못 남은 계정 — 닉네임을 다시 받아야 한다
  return { userId: data.user.id, nickname: '', friendCode: '' }
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut()
}

/** 프로필이 비어 있던 계정의 닉네임 채우기 */
export async function saveNickname(userId: string, nickname: string): Promise<void> {
  const { error } = await supabase()
    .from('profiles')
    .upsert({ user_id: userId, nickname: nickname.trim() })
  if (error) throw new Error(friendly(error.message))
}

/** 지금 로그인된 사람 — 없으면 null */
export async function currentProfile(): Promise<Profile | null> {
  const sb = supabase()
  const { data } = await sb.auth.getSession()
  const user = data.session?.user
  if (!user) return null
  const { data: rows } = await sb
    .from('profiles')
    .select('nickname, friend_code')
    .eq('user_id', user.id)
    .maybeSingle()
  return {
    userId: user.id,
    nickname: rows?.nickname ?? '',
    friendCode: rows?.friend_code ?? '',
  }
}
