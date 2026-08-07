import { checkNickname } from './nickname'
import { supabase } from './supabaseClient'

export interface Profile {
  userId: string
  nickname: string
  friendCode: string
}

/**
 * 가입의 두 갈래.
 *
 * 이메일 확인을 켜 두었으므로 가입 직후에는 아직 로그인이 아니다 — 메일함의
 * 링크를 눌러야 계정이 열린다. 그 사이에는 세션이 없고, 세션이 없으면 프로필도
 * 직접 만들 수 없다(행 단위 권한이 막는다). 그래서 프로필은 서버 쪽 트리거가
 * 계정과 함께 만든다. 여기서는 어느 갈래인지만 정확히 알려 준다.
 */
export type SignUpResult =
  | { kind: 'session'; profile: Profile }
  | { kind: 'confirm'; email: string }

/** 사람이 읽을 한국어 문장으로 바꾼다 — 서버의 영어 오류를 그대로 보이지 않는다 */
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return '이메일이나 비밀번호가 맞지 않다.'
  if (m.includes('different from the old password') || m.includes('same_password')) {
    return '새 비밀번호가 이전 비밀번호와 같다.'
  }
  if (m.includes('email not confirmed')) {
    return '아직 메일 확인이 끝나지 않았다. 메일함의 링크를 먼저 누르자.'
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return '이미 가입된 이메일이다. 로그인해 보자.'
  }
  if (m.includes('password should be') || m.includes('password should contain')) {
    return '비밀번호는 8자 이상이어야 한다.'
  }
  if (m.includes('email address') && m.includes('invalid')) {
    return '받을 수 있는 이메일 주소를 적어야 한다.'
  }
  if (m.includes('valid email')) return '이메일 형태가 아니다.'
  // 확인 메일은 발송 한도가 있다 — 한도에 걸린 것과 비밀번호가 틀린 것은 전혀 다른 일이다
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
    return '확인 메일 발송이 한도를 넘었다. 잠시 뒤에 다시 시도하자.'
  }
  if (m.includes('captcha')) {
    return '자동 가입 방지 확인에 실패했다. 잠시 뒤에 다시 시도하자.'
  }
  if (m.includes('rate limit') || m.includes('too many')) return '시도가 너무 잦다. 잠시 뒤에 다시.'
  if (m.includes('row-level security') || m.includes('42501')) {
    return '프로필을 만들 권한이 없다. 서버 설정을 확인해야 한다.'
  }
  if (m.includes('fetch') || m.includes('network')) return '서버에 닿지 못했다. 연결을 확인하자.'
  return '요청이 실패했다. 잠시 뒤에 다시 해 보자.'
}

/** 확인 메일이 돌아올 자리 — 배포 경로든 로컬이든 지금 열려 있는 곳으로 */
function redirectTarget(): string {
  return `${window.location.origin}${window.location.pathname}`
}

/**
 * 가입. 닉네임은 계정에 함께 실어 보내고, 프로필 행은 서버가 만든다 —
 * 세션이 없는 확인 대기 상태에서도 이름이 남아야 하기 때문이다.
 */
export async function signUp(
  email: string,
  password: string,
  nickname: string,
  captchaToken?: string,
): Promise<SignUpResult> {
  const check = checkNickname(nickname)
  if (!check.ok) throw new Error(check.reason ?? '쓸 수 없는 닉네임이다.')

  const sb = supabase()
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { nickname: nickname.trim() },
      emailRedirectTo: redirectTarget(),
      captchaToken,
    },
  })
  if (error) throw new Error(friendly(error.message))

  // 확인이 필요한 계정은 세션 없이 돌아온다. 이미 가입된 이메일도 같은 모양으로
  // 돌아오는데(계정이 있는지 알려 주지 않으려는 서버의 배려다) 우리도 굳이 가르지 않는다
  if (!data.session) return { kind: 'confirm', email }

  const profile = await currentProfile()
  return {
    kind: 'session',
    profile: profile ?? { userId: data.user?.id ?? '', nickname: nickname.trim(), friendCode: '' },
  }
}

/** 확인 메일 다시 보내기 — 첫 메일이 스팸함에 갇히는 일은 흔하다 */
export async function resendConfirmation(email: string, captchaToken?: string): Promise<void> {
  const { error } = await supabase().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirectTarget(), captchaToken },
  })
  if (error) throw new Error(friendly(error.message))
}

export async function signIn(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<Profile> {
  const sb = supabase()
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  })
  if (error) throw new Error(friendly(error.message))
  const profile = await currentProfile()
  if (profile) return profile
  // 트리거가 없던 시절에 만든 계정 — 닉네임을 다시 받아야 한다
  return { userId: data.user.id, nickname: '', friendCode: '' }
}

/**
 * 비밀번호 변경. 현재 비밀번호를 먼저 재검증한다 — 자리를 비운 사이에
 * 다른 사람이 바꿔 버리는 사고를 막는 최소한의 문턱이다.
 */
export async function changePassword(current: string, next: string): Promise<void> {
  const sb = supabase()
  const { data } = await sb.auth.getSession()
  const email = data.session?.user?.email
  if (!email) throw new Error('로그인이 필요하다.')
  const { error: verify } = await sb.auth.signInWithPassword({ email, password: current })
  if (verify) throw new Error('현재 비밀번호가 맞지 않다.')
  const { error } = await sb.auth.updateUser({ password: next })
  if (error) throw new Error(friendly(error.message))
}

/** 회원 탈퇴 — 서버 함수가 본인 확인 후 계정과 딸린 기록 전부를 지운다 */
export async function deleteMyAccount(reason: string, detail?: string): Promise<void> {
  const { data, error } = await supabase().functions.invoke('delete-my-account', {
    body: { reason, detail: detail || null },
  })
  if (error || !(data as { ok?: boolean })?.ok) {
    throw new Error('탈퇴 처리에 실패했다. 잠시 뒤에 다시 해 보고, 계속 안 되면 문의처로 알려 달라.')
  }
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut()
}

/** 프로필이 비어 있던 계정의 닉네임 채우기 */
export async function saveNickname(userId: string, nickname: string): Promise<void> {
  const check = checkNickname(nickname)
  if (!check.ok) throw new Error(check.reason ?? '쓸 수 없는 닉네임이다.')
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

export { checkNickname, validNickname, NICKNAME_MAX } from './nickname'
