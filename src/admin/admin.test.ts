import { describe, expect, it } from 'vitest'
import {
  auditTargetName,
  banLabel,
  describeAudit,
  latestSaveByUser,
  relativeTime,
  shouldCheckAdmin,
  signupsToBars,
} from './format'
import { decideAccess } from './guard'
import { parseRoute } from './router'

describe('운영 페이지 문지기', () => {
  it('로그인이 없으면 거절한다', () => {
    expect(decideAccess(null, null).kind).toBe('deny')
    expect(decideAccess(null, 'admin').kind).toBe('deny')
  })

  it('로그인해도 관리자가 아니면 거절한다', () => {
    expect(decideAccess('uid-1', 'user').kind).toBe('deny')
    expect(decideAccess('uid-1', null).kind).toBe('deny')
  })

  it('관리자만 통과한다', () => {
    expect(decideAccess('uid-1', 'admin')).toEqual({ kind: 'allow', userId: 'uid-1' })
  })
})

describe('해시 라우팅', () => {
  it('빈 해시와 모르는 해시는 대시보드다', () => {
    expect(parseRoute('')).toEqual({ view: 'dashboard' })
    expect(parseRoute('#/')).toEqual({ view: 'dashboard' })
    expect(parseRoute('#/없는화면')).toEqual({ view: 'dashboard' })
  })

  it('각 화면과 하위 탭을 읽는다', () => {
    expect(parseRoute('#/users')).toEqual({ view: 'users' })
    expect(parseRoute('#/logs')).toEqual({ view: 'logs', tab: 'signups' })
    expect(parseRoute('#/logs/gifts')).toEqual({ view: 'logs', tab: 'gifts' })
    expect(parseRoute('#/resources/jobs')).toEqual({ view: 'resources', file: 'jobs' })
  })
})

describe('타이틀 진입 링크 게이트 — 솔로는 서버를 모른다', () => {
  it('로그인 흔적이 없으면 묻지 않는다 — 서버 요청 0건의 근거', () => {
    expect(shouldCheckAdmin(['moduquest-options', 'moduquest-trait'])).toBe(false)
    expect(shouldCheckAdmin([])).toBe(false)
  })

  it('로그인해 있으면 확인을 시작한다 — 관리자인지는 서버가 판정한다', () => {
    expect(shouldCheckAdmin(['sb-xyz-auth-token', 'moduquest-options'])).toBe(true)
  })
})

describe('표시용 변환', () => {
  const now = new Date('2026-08-07T12:00:00Z').getTime()

  it('상대시각 — 분·시간·일로 줄여 말한다', () => {
    expect(relativeTime('2026-08-07T11:59:40Z', now)).toBe('방금')
    expect(relativeTime('2026-08-07T11:30:00Z', now)).toBe('30분 전')
    expect(relativeTime('2026-08-07T02:00:00Z', now)).toBe('10시간 전')
    expect(relativeTime('2026-08-01T12:00:00Z', now)).toBe('6일 전')
    expect(relativeTime('깨진값', now)).toBe('-')
  })

  it('정지 라벨 — 기한이 지나면 정지가 아니다', () => {
    expect(banLabel(null, now)).toBe('')
    expect(banLabel('2026-08-01T00:00:00Z', now)).toBe('')
    expect(banLabel('2026-08-14T00:00:00Z', now)).toContain('정지 중')
  })

  it('사용자별 최근 저장 — 여러 자리 중 가장 최근 것 하나', () => {
    const map = latestSaveByUser([
      { user_id: 'a', updated_at: '2026-08-01T00:00:00Z' },
      { user_id: 'a', updated_at: '2026-08-05T00:00:00Z' },
      { user_id: 'b', updated_at: '2026-08-03T00:00:00Z' },
    ])
    expect(map.get('a')).toBe('2026-08-05T00:00:00Z')
    expect(map.get('b')).toBe('2026-08-03T00:00:00Z')
  })

  it('가입 추이 막대 — 최대값 기준, 비면 빈 배열', () => {
    expect(signupsToBars([])).toEqual([])
    const bars = signupsToBars([
      { day: '2026-08-01', n: 2 },
      { day: '2026-08-02', n: 4 },
    ])
    expect(bars[0].ratio).toBe(0.5)
    expect(bars[1].ratio).toBe(1)
  })
})


describe('운영 조치를 사람 말로', () => {
  it('닉네임 변경은 무엇이 무엇으로 바뀌었는지 말한다', () => {
    expect(describeAudit('nickname_reset', { from: '캡차시험', to: '모험가7FC2' }, '모험가7FC2'))
      .toBe('캡차시험 → 모험가7FC2로 닉네임을 되돌렸다')
    expect(describeAudit('nickname_set', { from: '가', to: '나' }, '나'))
      .toBe('가 → 나로 닉네임을 바꿨다')
  })

  it('정지는 기간과 기한을 읽을 수 있게 적는다 — ISO 원문을 보여주지 않는다', () => {
    const text = describeAudit('ban', { days: 7, until: '2026-08-14T04:19:28.434Z' }, '이순신')
    expect(text).toContain('이순신의 멀티 이용을 7일 정지했다')
    expect(text).not.toContain('T04:19')
    expect(describeAudit('unban', { days: null, until: null }, '이순신'))
      .toBe('이순신의 정지를 풀었다')
  })

  it('삭제는 기록에 남긴 이름으로 말한다 — 계정이 이미 없기 때문이다', () => {
    expect(describeAudit('delete_user', { nickname: '모험가7FC2' }, '알 수 없음'))
      .toBe('모험가7FC2의 계정을 지웠다')
  })

  it('지워진 계정의 대상 이름은 기록에서 되살린다', () => {
    expect(auditTargetName({ nickname: '모험가7FC2' }, undefined, 'b4ab2a57-x'))
      .toBe('모험가7FC2 (지워진 계정)')
    expect(auditTargetName(null, '이순신', 'uuid')).toBe('이순신')
    expect(auditTargetName(null, undefined, 'b4ab2a57-aaaa')).toBe('b4ab2a57')
  })
})
