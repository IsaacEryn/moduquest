import { describe, expect, it } from 'vitest'
import items from '../data/items.json'
import type { GameData, ItemData } from '../core/types'
import { iconForItem } from '../render/itemIcons'
import { categoryOf, describeItem, itemAriaLabel } from './itemText'

const ITEMS = items as GameData['items']

describe('아이템 문구', () => {
  it('소모품은 회복량을 말한다 — 예전에는 아무 효과도 적히지 않았다', () => {
    expect(describeItem(ITEMS.potion_small)).toBe('체력 30 회복')
    expect(describeItem(ITEMS.potion_big)).toBe('체력 60 회복')
    expect(describeItem(ITEMS.mana_potion)).toBe('마력 15 회복')
  })

  it('장비는 능력치를 부호까지 그대로 말한다', () => {
    const line = describeItem(ITEMS.wood_sword)
    expect(line).toContain('공격 +2')
  })

  it('깎이는 능력치도 감추지 않는다', () => {
    const heavy = Object.values(ITEMS).find((i) => (i.stats?.spd ?? 0) < 0)
    expect(heavy, '속도가 깎이는 장비가 하나는 있어야 이 규칙을 지킬 수 있다').toBeTruthy()
    expect(describeItem(heavy as ItemData)).toMatch(/속도 -\d/)
  })

  it('갈래는 등급과 부위를 함께 말한다 — 색만으로 등급을 나누지 않으려고', () => {
    expect(categoryOf(ITEMS.potion_small)).toBe('소모품')
    expect(categoryOf(ITEMS.wood_sword)).toBe('일반 무기')
    expect(categoryOf(ITEMS.horn_bow)).toBe('정련 무기')
  })

  it('낭독 이름표에 개수·효과·값이 모두 담긴다 — 그림은 못 읽으니까', () => {
    const label = itemAriaLabel(ITEMS.potion_big, { count: 3, price: '8냥' })
    expect(label).toContain('큰 물약')
    expect(label).toContain('3개')
    expect(label).toContain('체력 60 회복')
    expect(label).toContain('8냥')
  })
})

describe('아이템 그림', () => {
  it('모든 아이템이 그림을 갖는다 — 데이터가 늘어도 빈칸이 생기지 않게', () => {
    for (const [id, item] of Object.entries(ITEMS)) {
      const icon = iconForItem(id, item)
      expect(icon.pixels.length, id).toBe(16)
      expect(Object.keys(icon.palette).length, id).toBeGreaterThan(0)
    }
  })

  it('그림에 쓰인 글자는 모두 팔레트에 있다 — 없으면 그 칸이 비어 보인다', () => {
    for (const [id, item] of Object.entries(ITEMS)) {
      const icon = iconForItem(id, item)
      const used = new Set(icon.pixels.join('').replace(/ /g, '').split(''))
      for (const ch of used) {
        expect(icon.palette[ch], `${id}의 '${ch}'`).toBeTruthy()
      }
    }
  })

  it('물약은 담긴 것에 따라 색이 다르다', () => {
    const heal = iconForItem('potion_small', ITEMS.potion_small)
    const mana = iconForItem('mana_potion', ITEMS.mana_potion)
    expect(heal.palette.L).not.toBe(mana.palette.L)
  })

  it('활과 지팡이는 검과 다른 모양이다', () => {
    const bow = iconForItem('wood_bow', ITEMS.wood_bow)
    const staff = iconForItem('wood_staff', ITEMS.wood_staff)
    const sword = iconForItem('wood_sword', ITEMS.wood_sword)
    expect(bow.pixels).not.toEqual(sword.pixels)
    expect(staff.pixels).not.toEqual(sword.pixels)
  })
})
