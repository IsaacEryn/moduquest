const KEY = 'moduquest-trait'

/**
 * 고른 특성 id의 영속화. 접근성 옵션과는 별도 키를 써서 서로 건드리지 않는다 —
 * 특성은 게임 규칙이고 옵션은 표현 방식이라, 둘이 섞이면 안 된다.
 */
export class TraitStore {
  get(): string | null {
    try {
      const raw = localStorage.getItem(KEY)
      return typeof raw === 'string' && raw.length > 0 ? raw : null
    } catch {
      return null
    }
  }

  set(id: string): void {
    localStorage.setItem(KEY, id)
  }
}
