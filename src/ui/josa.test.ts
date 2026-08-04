import { describe, expect, it } from 'vitest'
import { josa } from './announcer'

describe('조사 선택', () => {
  it('받침 있는 한글', () => {
    expect(josa('고블린', '을', '를')).toBe('고블린을')
    expect(josa('골렘', '이', '가')).toBe('골렘이')
  })

  it('받침 없는 한글', () => {
    expect(josa('슬라임', '을', '를')).toBe('슬라임을')
    expect(josa('힐러', '은', '는')).toBe('힐러는')
  })

  it('숫자로 끝나는 이름 — 읽는 소리의 받침 기준', () => {
    expect(josa('슬라임 1', '을', '를')).toBe('슬라임 1을') // 일
    expect(josa('슬라임 2', '을', '를')).toBe('슬라임 2를') // 이
    expect(josa('슬라임 3', '이', '가')).toBe('슬라임 3이') // 삼
    expect(josa('슬라임 4', '이', '가')).toBe('슬라임 4가') // 사
  })
})
