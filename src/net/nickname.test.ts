import { describe, expect, it } from 'vitest'
import { checkNickname } from './nickname'

describe('닉네임 — 길이와 모양', () => {
  it('평범한 이름은 통과한다', () => {
    for (const name of ['모험가', '달리는하늘', 'Isaac', '종소리12', '하늘 별', 'devil']) {
      expect(checkNickname(name), name).toEqual({ ok: true })
    }
  })

  it('비어 있거나 너무 길면 막는다', () => {
    expect(checkNickname('').ok).toBe(false)
    expect(checkNickname('   ').ok).toBe(false)
    expect(checkNickname('열세글자가되는긴이름이다').ok).toBe(true) // 12자
    expect(checkNickname('열네글자가되는아주긴이름이다').ok).toBe(false)
  })

  it('글자가 하나도 없으면 막는다 — 보이지 않는 이름은 이름이 아니다', () => {
    expect(checkNickname('...').ok).toBe(false)
    expect(checkNickname('​​').ok).toBe(false)
  })
})

describe('닉네임 — 운영자 사칭은 막는다', () => {
  const impersonations = [
    '관리자',
    '관리자님',
    '모두의원정대관리자',
    '운영자',
    '운영진',
    '어드민',
    'admin',
    'ADMIN',
    'Administrator',
    'moderator',
    'staff',
    '스태프',
    '시스템',
    'system',
    '공식계정',
    'official',
    '개발자',
    'moduquest',
  ]
  it.each(impersonations)('%s는 막힌다', (name) => {
    expect(checkNickname(name).ok).toBe(false)
  })

  it('이유를 함께 알려 준다 — 왜 막혔는지 모른 채 두지 않는다', () => {
    const result = checkNickname('관리자')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('운영자')
  })
})

describe('닉네임 — 흉내 낸 글자도 같은 말로 본다', () => {
  it('사이에 낀 공백·점·밑줄로는 피할 수 없다', () => {
    for (const name of ['관 리 자', '관.리.자', '운영_자', 'a d m i n', 'a.d.m.i.n']) {
      expect(checkNickname(name).ok, name).toBe(false)
    }
  })

  it('숫자로 흉내 낸 글자도 되돌려 본다', () => {
    for (const name of ['adm1n', '4dmin', '@dmin', 'admln', '4DM1N']) {
      expect(checkNickname(name).ok, name).toBe(false)
    }
  })

  it('전각 문자도 같은 말이다', () => {
    expect(checkNickname('ａｄｍｉｎ').ok).toBe(false)
  })

  it('보이지 않는 글자를 끼워도 소용없다', () => {
    expect(checkNickname('ad​min').ok).toBe(false)
    expect(checkNickname('관﻿리자').ok).toBe(false)
  })
})

describe('닉네임 — 짧은 토막은 이름 전체일 때만 막는다', () => {
  it('이름이 그 토막 자체면 막는다', () => {
    for (const name of ['gm', 'GM', 'mod', 'dev', 'bot', '봇', '운영', '관리']) {
      expect(checkNickname(name).ok, name).toBe(false)
    }
  })

  it('평범한 이름에 섞인 토막은 막지 않는다 — 잘못 막는 쪽이 더 나쁘다', () => {
    for (const name of ['모드러너', '데브캣', '봇물', '운영왕국', 'devil', 'godmode']) {
      expect(checkNickname(name).ok, name).toBe(true)
    }
  })
})
