import economy from '../../data/economy.json'
import items from '../../data/items.json'
import jobs from '../../data/jobs.json'
import monsters from '../../data/monsters.json'
import party from '../../data/party.json'
import progression from '../../data/progression.json'
import sets from '../../data/sets.json'
import traits from '../../data/traits.json'
import { dataTable, heading, note } from '../layout'

/**
 * 게임 리소스 — 읽기 전용.
 *
 * 수치는 저장소의 JSON이 단일 진실이고, 테스트와 락스텝 결정성이 그 위에 서
 * 있다. 여기서 고치게 만들면 배포본마다 다른 세계가 생겨 멀티가 무너진다.
 * 그래서 이 화면은 "지금 배포본이 어떤 수치로 돌고 있는가"를 보는 창이다 —
 * 정적 import라 서버 요청 없이 항상 배포본과 같은 버전을 보여준다.
 */

const FILES: { key: string; label: string; data: unknown }[] = [
  { key: 'items', label: '아이템', data: items },
  { key: 'jobs', label: '직업', data: jobs },
  { key: 'monsters', label: '몬스터', data: monsters },
  { key: 'economy', label: '경제', data: economy },
  { key: 'progression', label: '성장', data: progression },
  { key: 'traits', label: '특성', data: traits },
  { key: 'sets', label: '세트', data: sets },
  { key: 'party', label: '기본 파티', data: party },
]

/** 객체 하나를 "필드: 값" 행들로 편다. 깊은 값은 JSON 문자열로 */
function flat(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function renderResources(content: HTMLElement, file: string): void {
  const active = FILES.some((f) => f.key === file) ? file : 'items'
  content.replaceChildren(heading('게임 리소스'))

  const tabs = document.createElement('nav')
  tabs.className = 'admin-tabs'
  tabs.setAttribute('aria-label', '리소스 파일')
  for (const f of FILES) {
    const a = document.createElement('a')
    a.href = `#/resources/${f.key}`
    a.textContent = f.label
    if (f.key === active) a.setAttribute('aria-current', 'page')
    tabs.append(a)
  }
  content.append(
    tabs,
    note(
      '읽기 전용이다. 수치의 진실은 저장소의 src/data이고, 고치면 테스트가 정합성을 검증한 뒤 배포로 나간다 — 여기서 고치게 만들면 배포본마다 다른 세계가 생겨 함께 하기가 무너진다.',
    ),
  )

  const chosen = FILES.find((f) => f.key === active)!
  const data = chosen.data as Record<string, unknown>

  if (Array.isArray(data)) {
    // 배열(기본 파티 등) — 순번 표
    content.append(
      dataTable(
        chosen.label,
        ['#', '값'],
        data.map((v, i) => [String(i), flat(v)]),
      ),
    )
    return
  }

  // id → 객체 꼴이면 필드를 열로 편다 (아이템·직업·몬스터가 이 꼴)
  const entries = Object.entries(data)
  const allObjects = entries.length > 0 && entries.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
  if (allObjects) {
    const fieldSet = new Set<string>()
    for (const [, v] of entries) for (const k of Object.keys(v as object)) fieldSet.add(k)
    const fields = [...fieldSet]
    content.append(
      dataTable(
        chosen.label,
        ['id', ...fields],
        entries.map(([id, v]) => [id, ...fields.map((f) => flat((v as Record<string, unknown>)[f]))]),
      ),
    )
  } else {
    // 설정 꼴(경제·성장) — 키-값 표
    content.append(
      dataTable(
        chosen.label,
        ['키', '값'],
        entries.map(([k, v]) => [k, flat(v)]),
      ),
    )
  }
}
