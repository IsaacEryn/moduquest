/**
 * 표시용 변환 — 전부 순수 함수. 화면이 데이터를 어떻게 읽는지가 여기 모여 있고,
 * 시험이 이 파일만 보면 표가 거짓말하지 않는다는 것을 확인할 수 있다.
 */

/** ISO 시각 → "3분 전" 같은 상대 표현. now 주입은 시험을 위해서다 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '-'
  const diff = now - t
  if (diff < 0) return '방금'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}일 전`
  return new Date(t).toLocaleDateString('ko-KR')
}

export function fullTime(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return '-'
  return t.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

/** 정지 상태 라벨 — null·과거 기한은 정상이다 */
export function banLabel(bannedUntil: string | null, now: number = Date.now()): string {
  if (!bannedUntil) return ''
  const t = new Date(bannedUntil).getTime()
  if (Number.isNaN(t) || t <= now) return ''
  return `정지 중 (${fullTime(bannedUntil)}까지)`
}

/** user_saves 행들 → 사용자별 가장 최근 저장 시각 */
export function latestSaveByUser(
  rows: { user_id: string; updated_at: string }[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const row of rows) {
    const prev = out.get(row.user_id)
    if (!prev || row.updated_at > prev) out.set(row.user_id, row.updated_at)
  }
  return out
}

/** 가입 추이 → 막대 높이(0~1). 최대값 기준 정규화, 비어 있으면 빈 배열 */
export function signupsToBars(rows: { day: string; n: number }[]): { day: string; ratio: number }[] {
  if (rows.length === 0) return []
  const max = Math.max(...rows.map((r) => r.n))
  if (max <= 0) return rows.map((r) => ({ day: r.day, ratio: 0 }))
  return rows.map((r) => ({ day: r.day, ratio: r.n / max }))
}

/**
 * 타이틀 진입 링크의 게이트 — 로그인 흔적(sb-*-auth-token)이 있을 때만 묻는다.
 * 이 함수가 false면 서버 요청이 0건이고 운영 관련 코드가 내려오지도 않는다 —
 * "솔로는 서버를 모른다" 원칙의 시험 가능한 형태다.
 *
 * 관리자인지, 주소가 무엇인지는 전부 서버가 판정한다.
 */
export function shouldCheckAdmin(storageKeys: string[]): boolean {
  return storageKeys.some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
}

/**
 * 감사 로그 한 줄을 사람이 읽는 문장으로.
 *
 * 예전에는 여기에 JSON을 그대로 찍었다. {"days":1,"until":"...Z"} 같은 것은
 * 기록이 아니라 부스러기다 — 무슨 일이 있었는지 읽으려면 사람이 파싱을 해야 했다.
 */
export function describeAudit(
  action: string,
  detail: Record<string, unknown> | null,
  targetName: string,
): string {
  const d = detail ?? {}
  switch (action) {
    case 'nickname_reset':
      return `${d.from ?? '?'} → ${d.to ?? '?'}로 닉네임을 되돌렸다`
    case 'nickname_set':
      return `${d.from ?? '?'} → ${d.to ?? '?'}로 닉네임을 바꿨다`
    case 'ban': {
      const days = typeof d.days === 'number' ? `${d.days}일` : ''
      const until = typeof d.until === 'string' ? ` (${fullTime(d.until)}까지)` : ''
      return `${targetName}의 멀티 이용을 ${days} 정지했다${until}`
    }
    case 'unban':
      return `${targetName}의 정지를 풀었다`
    case 'delete_user':
      return `${d.nickname ?? targetName}의 계정을 지웠다`
    case 'email_lookup':
      return `${targetName}의 이메일을 확인했다`
    default:
      return action
  }
}

/** 삭제된 계정은 닉네임 맵에 없다 — 기록에 남긴 이름이라도 보여준다 */
export function auditTargetName(
  detail: Record<string, unknown> | null,
  fromMap: string | undefined,
  targetId: unknown,
): string {
  if (fromMap) return fromMap
  const saved = (detail ?? {}).nickname
  if (typeof saved === 'string' && saved) return `${saved} (지워진 계정)`
  return String(targetId ?? '').slice(0, 8)
}


/**
 * 페이저가 말해야 하는 것 — 지금 몇 쪽인지, 전체가 몇 쪽인지, 무엇을 보고 있는지.
 * 이전/다음 버튼만 있으면 "끝에 왔는지"조차 눌러 봐야 안다.
 */
export interface PagerState {
  page: number
  pages: number
  /** "51–100번째 · 전체 237건" */
  label: string
  hasPrev: boolean
  hasNext: boolean
}

export function pagerState(page: number, total: number, per: number): PagerState {
  const pages = Math.max(1, Math.ceil(total / per))
  const from = total === 0 ? 0 : page * per + 1
  const to = Math.min(total, (page + 1) * per)
  return {
    page,
    pages,
    label:
      total === 0 ? '기록 없음' : `${from}–${to}번째 · 전체 ${total.toLocaleString('ko-KR')}건`,
    hasPrev: page > 0,
    hasNext: page + 1 < pages,
  }
}
