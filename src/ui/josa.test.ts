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

describe('로마자·숫자로 끝나는 이름', () => {
  it('우리말로 읽어 받침이 남는 로마자를 가린다', () => {
    // eryn → 에린(ㄴ), Isaac → 아이작(ㄱ), Tom → 톰(ㅁ)
    expect(josa('eryn', '과', '와')).toBe('eryn과')
    expect(josa('Isaac', '과', '와')).toBe('Isaac과')
    expect(josa('Tom', '이', '가')).toBe('Tom이')
    expect(josa('Bob', '은', '는')).toBe('Bob은')
  })

  it('받침 없이 끝나는 이름은 그대로 둔다', () => {
    // Chris → 크리스, David → 데이비드, Amy → 에이미
    expect(josa('Chris', '과', '와')).toBe('Chris와')
    expect(josa('David', '이', '가')).toBe('David가')
    expect(josa('Amy', '은', '는')).toBe('Amy는')
  })

  it('-ng로 끝나면 ㅇ 받침이다 — 낱자 g와 다르다', () => {
    expect(josa('King', '과', '와')).toBe('King과')
    expect(josa('Doug', '과', '와')).toBe('Doug와')
  })

  it('숫자 이름은 읽는 소리를 따른다', () => {
    expect(josa('슬라임 1', '은', '는')).toBe('슬라임 1은')
    expect(josa('슬라임 2', '은', '는')).toBe('슬라임 2는')
  })

  it('모르는 글자로 끝나면 받침 없는 쪽으로 — 덜 어색하다', () => {
    expect(josa('🙂', '과', '와')).toBe('🙂와')
  })
})
