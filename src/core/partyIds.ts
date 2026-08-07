/**
 * 파티원의 이름표.
 *
 * 예전에는 직업 id가 곧 파티원 id였다 — 같은 직업이 파티에 하나뿐이라는 전제
 * 위에서다. 중복 직업을 허용하면서 그 전제가 무너졌고, 전투 대상 지정·장비·강화가
 * 전부 이 id에 매달려 있어서 유도 규칙을 한 곳에 모았다.
 *
 * 규칙: 첫 번째 전사는 그대로 warrior, 두 번째부터 warrior2, warrior3.
 * 자리 순서에서만 유도되므로 모든 화면이 같은 id를 계산한다(락스텝 결정성).
 * 중복이 없는 파티(지금까지의 모든 저장)에서는 id가 직업과 같아 옛 기록이 그대로 산다.
 */

/** 자리 순서의 직업 목록 → 파티원 id 목록 */
export function memberIdsOf(jobs: string[]): string[] {
  const seen = new Map<string, number>()
  return jobs.map((job) => {
    const n = (seen.get(job) ?? 0) + 1
    seen.set(job, n)
    return n === 1 ? job : `${job}${n}`
  })
}

/**
 * 화면에 보일 이름도 같은 규칙을 따른다 — "전사", "전사 2".
 * 같은 이름이 둘 있으면 전투 대상 고르기와 낭독이 누구인지 말할 수 없다.
 */
export function memberNamesOf(jobs: string[], nameOf: (job: string) => string): string[] {
  const seen = new Map<string, number>()
  return jobs.map((job) => {
    const n = (seen.get(job) ?? 0) + 1
    seen.set(job, n)
    return n === 1 ? nameOf(job) : `${nameOf(job)} ${n}`
  })
}
