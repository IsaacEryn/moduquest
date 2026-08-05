import { describe, expect, it } from 'vitest'
import { TRACKS, midiToFreq } from './music'

/**
 * 가락은 손으로 적은 음표 배열이라 오타가 조용히 섞인다 — 한 음의 박자를 잘못 적으면
 * 두 성부가 서서히 어긋나고, 몇 바퀴 뒤에는 다른 곡이 된다. 마디로 딱 떨어지는지를
 * 테스트가 지킨다.
 */
describe('배경음악 데이터', () => {
  const sum = (notes: { b: number }[]) => notes.reduce((t, x) => t + x.b, 0)

  it('가락과 저음의 길이가 같고 4박 마디로 떨어진다', () => {
    for (const [id, t] of Object.entries(TRACKS)) {
      const lead = sum(t.lead)
      const bass = sum(t.bass)
      expect(lead, `${id}의 가락 길이`).toBe(bass)
      expect(lead % 4, `${id}가 마디로 떨어지지 않는다`).toBe(0)
      expect(lead, `${id}가 너무 짧다`).toBeGreaterThanOrEqual(8)
    }
  })

  it('음표는 들을 수 있는 범위 안에 있다', () => {
    for (const [id, t] of Object.entries(TRACKS)) {
      for (const notes of [t.lead, t.bass]) {
        for (const note of notes) {
          expect(note.b, `${id}에 길이 0 이하인 음표`).toBeGreaterThan(0)
          // 0은 쉼표. 그 밖은 사람이 듣기 좋은 대역(약 33Hz~2kHz)
          if (note.m !== 0) {
            expect(note.m, `${id}의 너무 낮은 음`).toBeGreaterThanOrEqual(24)
            expect(note.m, `${id}의 너무 높은 음`).toBeLessThanOrEqual(96)
          }
        }
      }
    }
  })

  it('빠르기는 걸을 만한 범위다', () => {
    for (const [id, t] of Object.entries(TRACKS)) {
      expect(t.bpm, `${id}의 빠르기`).toBeGreaterThanOrEqual(60)
      expect(t.bpm, `${id}의 빠르기`).toBeLessThanOrEqual(180)
    }
  })

  it('스테이지마다 곡이 있고 서로 다르다', () => {
    for (const id of ['title', 'stage1', 'stage2', 'stage3', 'battle', 'boss']) {
      expect(TRACKS[id], `${id} 곡`).toBeDefined()
    }
    // 같은 가락을 두 곳에 쓰면 어디에 있는지 귀로 구분되지 않는다
    const melodies = Object.values(TRACKS).map((t) => t.lead.map((n) => `${n.m}:${n.b}`).join(','))
    expect(new Set(melodies).size).toBe(melodies.length)
  })

  it('가온 라(A4)는 440Hz다', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
  })
})
