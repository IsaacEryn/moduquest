import { describe, expect, it } from 'vitest'
import {
  banLabel,
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

