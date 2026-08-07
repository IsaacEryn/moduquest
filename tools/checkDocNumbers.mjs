#!/usr/bin/env node
/*
  문서가 인용한 수치를 데이터와 맞대 본다.

  하루에 세 번 어긋났다 — 특성이 일곱에서 여덟이 됐는데 문서는 일곱이었고, 조우가
  늘었는데 전투 판수는 옛 곱셈이었고, 승리 회복은 데이터가 두 번 바뀌는 동안 문서가
  한 번도 안 따라왔다. 셋 다 사람이 옮겨 적는 값이었다는 게 공통점이다.

  게임 화면의 수치는 이미 데이터에서 조립하지만(src/ui/helpFacts.ts), 산문으로 쓴
  문서는 그럴 수 없다. 그래서 조립하는 대신 맞대 본다.

  쓰기: node tools/checkDocNumbers.mjs
  어긋나면 종료 코드 1. 제출 문서를 PDF로 내기 전에 반드시 한 번 돌릴 것.
*/
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')
const json = (p) => JSON.parse(read(p))

const traits = json('src/data/traits.json').traits
const jobs = json('src/data/jobs.json')
const prog = json('src/data/progression.json')
const stages = [1, 2, 3].map((i) => json(`src/data/stages/stage${i}.json`))

const traitCount = Object.keys(traits).length
const jobCount = Object.keys(jobs).length
const encounters = stages.reduce(
  (n, s) => n + s.areas.reduce((m, a) => m + a.encounters.length + (a.boss ? 1 : 0), 0),
  0,
)
// 조합 = 직업 하나를 내가 고르고 나머지 중 둘 — balance.test.ts의 allPartyCombos와 같은 계산
const combos = (jobCount * (jobCount - 1) * (jobCount - 2)) / 2
const battles = combos * traitCount * encounters
const pct = (r) => `${+(r * 100).toFixed(1)}`.replace(/\.0$/, '')
const heal = prog.victoryHealRatio.map(pct)

/*
  규칙 하나 = 「어떤 문맥에서 어떤 수를 말하는가」와 「데이터가 말하는 값」.

  문맥(where)을 반드시 함께 잡는다. 그러지 않으면 "6.2% · 3.2% · 1.4%"(소모량 측정치)
  같은 무관한 수까지 승리 회복으로 오해한다 — 실제로 처음 만들었을 때 그랬다.
*/
const RULES = [
  {
    what: '특성 수',
    where: /특성 ([0-9]+)종/g,
    expect: String(traitCount),
  },
  {
    what: '전투 전수 판수',
    where: /모든 전투\(([0-9,]+)판\)|세 스테이지의 모든 전투\(([0-9,]+)판\)/g,
    expect: battles.toLocaleString('en-US'),
  },
  {
    what: '승리 회복 곡선',
    where: /승리 회복을 스테이지마다[^(]*\(([0-9.]+% [→·] [0-9.]+% [→·] [0-9.]+%)\)/g,
    expect: [`${heal[0]}% → ${heal[1]}% → ${heal[2]}%`, `${heal[0]}% · ${heal[1]}% · ${heal[2]}%`],
  },
  {
    what: '뒤 스테이지 회복 곡선',
    where: /뒤 스테이지일수록 덜 돌아온다<\/strong>\s*\(([^)]+)\)/g,
    expect: [`${heal[0]}% → ${heal[1]}% → ${heal[2]}%`],
  },
]

const DOCS = [
  'README.md',
  'CREDITS.md',
  'docs/02-players.md',
  'docs/03-game-design.md',
  'docs/06-decisions.md',
  '.private/submission/game-intro.html',
  '.private/submission/ai-tech.html',
]

let bad = 0
let checked = 0
for (const doc of DOCS) {
  if (!existsSync(url(doc))) continue
  const text = read(doc)
  for (const rule of RULES) {
    const want = [rule.expect].flat()
    for (const m of text.matchAll(rule.where)) {
      const found = m.slice(1).find((g) => g !== undefined)
      if (found === undefined) continue
      checked += 1
      if (want.includes(found)) continue
      console.error(`  ✗ ${doc} — ${rule.what}: 문서 "${found}" · 데이터 "${want.join('" 또는 "')}"`)
      bad += 1
    }
  }
}

/*
  테스트 수는 데이터가 아니라 실행이 정한다. 그래서 여기서만 실제로 돌려 센다.

  이 수가 가장 크게 틀렸었다 — 작업용 워크트리의 낡은 사본이 함께 세어져 문서에
  두 배(1,033)가 적혔다. vite.config.ts가 그 자리를 막았지만, 세는 일을 아예
  여기로 옮겨 두면 다음에 또 어긋날 자리가 없다.
*/
function countTests() {
  try {
    const out = execFileSync('npx', ['vitest', 'run', '--reporter=json'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
    const report = JSON.parse(out.slice(out.indexOf('{')))
    return { tests: report.numTotalTests }
  } catch {
    return null
  }
}

const counted = countTests()
if (counted) {
  const claimed = [...read('.private/submission/ai-tech.html').matchAll(/유닛 테스트 ([0-9,]+)개/g)]
  for (const m of claimed) {
    checked += 1
    const want = counted.tests.toLocaleString('en-US')
    if (m[1] === want) continue
    console.error(`  ✗ .private/submission/ai-tech.html — 유닛 테스트 수: 문서 "${m[1]}" · 실제 "${want}"`)
    bad += 1
  }
} else {
  console.error('  ! 테스트를 돌리지 못해 유닛 테스트 수는 대조하지 못했다')
}

console.log('데이터에서 센 값')
console.log(`  특성 ${traitCount}종 · 직업 ${jobCount} · 조우 ${encounters} · 파티 조합 ${combos}`)
console.log(`  전투 전수 ${battles.toLocaleString('en-US')}판`)
console.log(`  승리 회복 ${heal.join('% · ')}%`)
if (counted) console.log(`  유닛 테스트 ${counted.tests.toLocaleString('en-US')}개`)
console.log(`\n문서에서 대조한 곳 ${checked}군데`)

if (bad > 0) {
  console.error(`문서와 데이터가 ${bad}곳 어긋났다.`)
  process.exit(1)
}
console.log('어긋난 곳 없음.')
