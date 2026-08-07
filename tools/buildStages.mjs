// tools/maps.md의 도면을 읽어 src/data/stages/*.json을 만든다.
// 타일을 손으로 세지 않기 위한 도구다 — 도면이 틀리면 여기서 잡는다.
//
//   node tools/buildStages.mjs
//
// 스테이지1은 구역 하나짜리라 예전 지도를 그대로 옮겼고, 값이 바뀌지 않았음을
// 이 스크립트가 아니라 테스트가 지킨다.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WIDTH = 12
const HEIGHT = 10

/** 구역이 무엇을 갖는가 — 조우 구성·보상·출구는 여기에만 있다(변형은 좌표만) */
const STAGES = [
  {
    id: 'stage1',
    title: '고요한 숲',
    objective: '돌 골렘을 물리치자.',
    clearMessage: '숲이 조용해진 이유를 알아야 한다. 소리를 따라가자.',
    variantCount: 1,
    areas: [
      {
        id: 'a',
        name: '고요한 숲',
        symbols: { 1: 'e1', 2: 'e2', C: 't1', B: 'boss' },
        encounters: [
          { id: 'e1', monsters: ['slime', 'slime'], dialogue: 'firstBattle' },
          { id: 'e2', monsters: ['goblin', 'slime'] },
        ],
        chests: [{ id: 't1', items: ['potion_small', 'leather_armor'] }],
        exits: [],
        boss: { id: 'boss', monsters: ['boss_golem'] },
      },
    ],
  },
  {
    id: 'stage2',
    title: '울림 굴',
    objective: '울림 골렘을 물리치자.',
    clearMessage: '굴을 지났다. 밖에 탑이 보인다.',
    variantCount: 2,
    areas: [
      {
        id: 'a',
        name: '굴 입구',
        darkness: { radius: 5, note: '굴이 어둡다.' },
        symbols: { 1: 'e1', 2: 'e2', C: 't1', n: 'deeper' },
        encounters: [
          { id: 'e1', monsters: ['cave_bat', 'cave_bat'], dialogue: 'firstBattle' },
          { id: 'e2', monsters: ['cave_bat', 'goblin'], dialogue: 'alcove' },
        ],
        chests: [{ id: 't1', items: ['potion_small', 'mana_potion'] }],
        exits: [{ id: 'deeper', name: '안쪽으로 난 굴', to: 'b:back' }],
      },
      {
        id: 'b',
        name: '울림 통로',
        darkness: { radius: 5, note: '굴이 어둡다.' },
        symbols: { 1: 'e1', 2: 'e2', C: 't1', u: 'back', n: 'deeper' },
        encounters: [
          { id: 'e1', monsters: ['goblin', 'goblin'], dialogue: 'eastPath' },
          { id: 'e2', monsters: ['cave_bat', 'goblin'] },
        ],
        chests: [{ id: 't1', items: ['potion_big', 'steel_gloves'] }],
        exits: [
          { id: 'back', name: '입구로 난 굴', to: 'a:deeper' },
          { id: 'deeper', name: '더 안쪽으로 난 굴', to: 'c:back' },
        ],
      },
      {
        id: 'c',
        name: '굴 안쪽',
        darkness: { radius: 5, note: '굴이 어둡다.' },
        symbols: { 1: 'e1', 2: 'e2', C: 't1', u: 'back', B: 'boss' },
        encounters: [
          { id: 'e1', monsters: ['cave_bat', 'cave_bat'] },
          { id: 'e2', monsters: ['goblin', 'cave_bat'] },
        ],
        chests: [{ id: 't1', items: ['potion_big'] }],
        exits: [{ id: 'back', name: '통로로 난 굴', to: 'b:deeper' }],
        boss: { id: 'boss', monsters: ['echo_golem'] },
      },
    ],
  },
  {
    id: 'stage3',
    title: '울림 탑',
    objective: '종지기를 물리치자.',
    clearMessage: '종이 멈췄다. 숲에 소리가 돌아왔다.',
    variantCount: 2,
    areas: [
      {
        id: 'a',
        name: '탑 아래',
        symbols: { 1: 'e1', 2: 'e2', C: 't1', n: 'up' },
        encounters: [
          { id: 'e1', monsters: ['goblin', 'cave_bat'], dialogue: 'firstBattle' },
          { id: 'e2', monsters: ['echo_shard'] },
        ],
        chests: [{ id: 't1', items: ['potion_small'] }],
        exits: [{ id: 'up', name: '위로 오르는 계단', to: 'b:down' }],
      },
      {
        id: 'b',
        name: '갈라진 길',
        symbols: { 1: 'e1', 2: 'e2', u: 'down', s: 'narrow', w: 'wide' },
        encounters: [
          { id: 'e1', monsters: ['echo_shard'], dialogue: 'shortcut' },
          { id: 'e2', monsters: ['echo_shard', 'goblin'], dialogue: 'hardened' },
        ],
        exits: [
          { id: 'down', name: '아래로 내려가는 계단', to: 'a:up' },
          {
            id: 'narrow',
            name: '좁은 틈',
            note: '종지기에게 곧장 간다.',
            to: 'd:narrow',
          },
          {
            id: 'wide',
            name: '넓은 길',
            note: '돌아가지만 보물이 있다.',
            to: 'c:wide',
          },
        ],
      },
      {
        id: 'c',
        name: '넓은 길',
        symbols: { 1: 'e1', 2: 'e2', M: 'e3', C: 't1', D: 't2', w: 'wide', t: 'top' },
        encounters: [
          { id: 'e1', monsters: ['echo_shard', 'echo_shard'] },
          { id: 'e2', monsters: ['goblin', 'echo_shard'] },
          // 선택 관문. 보물로 가는 길목에 서 있고, 바깥으로 돌면 만나지 않는다
          { id: 'e3', monsters: ['echo_priest'], dialogue: 'priest' },
        ],
        chests: [
          { id: 't1', items: ['potion_big', 'echo_shoes'] },
          { id: 't2', items: ['stamina_potion', 'mana_potion'] },
        ],
        exits: [
          { id: 'wide', name: '갈라진 길로 돌아가는 길', to: 'b:wide' },
          { id: 'top', name: '꼭대기로 오르는 계단', to: 'd:top' },
        ],
      },
      {
        id: 'd',
        name: '종지기의 자리',
        symbols: { 1: 'e1', s: 'narrow', t: 'top', B: 'boss' },
        encounters: [{ id: 'e1', monsters: ['echo_shard', 'goblin'] }],
        exits: [
          { id: 'narrow', name: '좁은 틈', to: 'b:narrow' },
          { id: 'top', name: '넓은 길로 내려가는 계단', to: 'c:top' },
        ],
        boss: { id: 'boss', monsters: ['bell_keeper', 'echo_shard', 'echo_shard'] },
      },
    ],
  },
]

/** maps.md에서 `### 스테이지: 구역: 이름 / vN` 아래 코드블록을 긁어 온다 */
function readDiagrams() {
  const text = readFileSync(join(root, 'tools/maps.md'), 'utf8')
  const out = new Map()
  const re = /^###\s+(\w+)\s*\/\s*(\w+)\s*\/\s*v(\d+)[^\n]*\n(?:[^\n]*\n)*?```\n([\s\S]*?)```/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const [, stageId, areaId, v, body] = m
    const lines = body.split('\n').filter((l) => l.length > 0)
    out.set(`${stageId}/${areaId}/${Number(v) - 1}`, lines)
  }
  return out
}

const problems = []
const fail = (where, msg) => problems.push(`${where}: ${msg}`)

function buildVariant(stage, area, vIndex, lines, where) {
  if (lines.length !== HEIGHT) {
    fail(where, `줄 수가 ${lines.length} (${HEIGHT}이어야 한다)`)
    return null
  }
  const tiles = []
  const places = {}
  let start
  let checkpoint
  for (let y = 0; y < HEIGHT; y++) {
    const line = lines[y]
    if (line.length !== WIDTH) {
      fail(where, `${y}번째 줄 길이가 ${line.length} (${WIDTH}이어야 한다)`)
      return null
    }
    const row = []
    for (let x = 0; x < WIDTH; x++) {
      const ch = line[x]
      if (ch === '#') {
        row.push(1)
        continue
      }
      row.push(0)
      if (ch === '.') continue
      if (ch === 'S') {
        start = { x, y }
        continue
      }
      if (ch === 'P') {
        checkpoint = { x, y }
        continue
      }
      const id = area.symbols?.[ch]
      if (!id) {
        fail(where, `(${x},${y})의 기호 '${ch}'를 구역이 선언하지 않았다`)
        continue
      }
      if (places[id]) fail(where, `'${ch}'(${id})가 두 번 나온다`)
      places[id] = { x, y }
    }
    tiles.push(row)
  }
  const variant = { tiles, places }
  if (checkpoint) variant.checkpoint = checkpoint
  if (start) variant.start = start
  return variant
}

const isFloor = (v, p) =>
  p.y >= 0 && p.y < HEIGHT && p.x >= 0 && p.x < WIDTH && v.tiles[p.y][p.x] === 0

const NEIGHBORS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
]

function reachable(v, from, to, blockedCells = []) {
  const blocked = new Set(blockedCells.map((p) => `${p.x},${p.y}`))
  const seen = new Set()
  const queue = [from]
  while (queue.length > 0) {
    const p = queue.shift()
    const key = `${p.x},${p.y}`
    if (seen.has(key)) continue
    seen.add(key)
    if (p.x === to.x && p.y === to.y) return true
    for (const d of NEIGHBORS) {
      const n = { x: p.x + d.x, y: p.y + d.y }
      if (isFloor(v, n) && !blocked.has(`${n.x},${n.y}`)) queue.push(n)
    }
  }
  return false
}

function entryOf(v, exitShortId) {
  const door = v.places[exitShortId]
  if (!door) return null
  for (const d of NEIGHBORS) {
    const p = { x: door.x + d.x, y: door.y + d.y }
    if (isFloor(v, p)) return p
  }
  return null
}

/** 도면이 규칙을 지키는지 — 여기서 막지 않으면 게임 안에서 조용히 이상해진다 */
function validate(stage, area, vIndex, v, where) {
  const declared = [
    ...area.encounters.map((e) => e.id),
    ...(area.chests ?? []).map((c) => c.id),
    ...area.exits.map((e) => e.id),
    ...(area.boss ? [area.boss.id] : []),
  ]
  for (const id of declared) {
    if (!v.places[id]) fail(where, `'${id}' 자리가 도면에 없다`)
  }
  for (const id of Object.keys(v.places)) {
    if (!declared.includes(id)) fail(where, `'${id}'는 구역이 선언하지 않았다`)
  }
  const hasCheckpoint = !!v.checkpoint
  const wantsCheckpoint = !!area.boss // 쉼터는 보스와 같은 구역에 둔다
  if (hasCheckpoint !== wantsCheckpoint) {
    fail(where, wantsCheckpoint ? '쉼터(P)가 없다' : '쉼터(P)가 있으면 안 된다')
  }
  const isFirst = stage.areas[0].id === area.id
  if (isFirst !== !!v.start) fail(where, isFirst ? '시작(S)이 없다' : '시작(S)이 있으면 안 된다')

  // 문 앞에 설 자리가 있어야 하고, 문 옆에서 전투가 나면 전이가 끌려간다
  for (const exit of area.exits) {
    if (!entryOf(v, exit.id)) fail(where, `'${exit.id}' 문 옆에 설 바닥이 없다`)
    // 문은 막다른 칸이어야 한다. 통로 한가운데 있으면 지나가려던 사람이 끌려가고,
    // 그 문 너머에만 있는 것은 영영 닿을 수 없게 된다
    const door0 = v.places[exit.id]
    if (door0) {
      const open = NEIGHBORS.filter((d) => isFloor(v, { x: door0.x + d.x, y: door0.y + d.y }))
      if (open.length !== 1) {
        fail(where, `문 '${exit.id}'이 막다른 칸이 아니다(트인 쪽 ${open.length})`)
      }
    }
    const door = v.places[exit.id]
    if (!door) continue
    for (const e of area.encounters) {
      const p = v.places[e.id]
      if (!p) continue
      const dist = Math.abs(p.x - door.x) + Math.abs(p.y - door.y)
      if (dist < 2) fail(where, `문 '${exit.id}'와 조우 '${e.id}'가 너무 가깝다(${dist})`)
    }
    if (v.checkpoint && v.checkpoint.x === door.x && v.checkpoint.y === door.y) {
      fail(where, `문 '${exit.id}'가 쉼터와 겹친다`)
    }
  }
  if (v.checkpoint && area.boss) {
    const b = v.places[area.boss.id]
    const dist = Math.abs(b.x - v.checkpoint.x) + Math.abs(b.y - v.checkpoint.y)
    if (dist < 2) fail(where, `쉼터와 보스가 ${dist}칸 — 보스 전 대사가 유실된다`)
  }

  // 서는 자리 어디에서든 모든 것에 갈 수 있어야 한다.
  // 문 칸은 밟는 순간 구역이 바뀌므로, 목표가 아닌 문은 벽으로 치고 길을 찾는다 —
  // 그러지 않으면 "다른 문을 밟아야만 닿는 곳"이 생겨 왕복만 하게 된다
  const doorCells = area.exits.map((e) => v.places[e.id]).filter(Boolean)
  const froms = [v.start, ...area.exits.map((e) => entryOf(v, e.id))].filter(Boolean)
  const targets = [
    ...Object.entries(v.places).map(([id, p]) => ({ id, p })),
    ...(v.checkpoint ? [{ id: '쉼터', p: v.checkpoint }] : []),
  ]
  for (const from of froms) {
    for (const { id, p } of targets) {
      const blocked = doorCells.filter((d) => !(d.x === p.x && d.y === p.y))
      if (!reachable(v, from, p, blocked)) {
        fail(where, `(${from.x},${from.y})에서 '${id}'에 문을 밟지 않고 갈 수 없다`)
      }
    }
  }
}

const diagrams = readDiagrams()
const scripts = new Map(
  STAGES.map((s) => [
    s.id,
    JSON.parse(readFileSync(join(root, `src/data/stages/${s.id}.json`), 'utf8')).script,
  ]),
)

for (const stage of STAGES) {
  const areas = []
  for (const area of stage.areas) {
    const variants = []
    for (let v = 0; v < stage.variantCount; v++) {
      const where = `${stage.id}/${area.id}/v${v + 1}`
      const lines = diagrams.get(`${stage.id}/${area.id}/${v}`)
      if (!lines) {
        fail(where, '도면이 없다')
        continue
      }
      const built = buildVariant(stage, area, v, lines, where)
      if (!built) continue
      validate(stage, area, v, built, where)
      variants.push(built)
    }
    const out = { id: area.id, name: area.name }
    if (area.darkness) out.darkness = area.darkness
    out.encounters = area.encounters
    if (area.chests) out.chests = area.chests
    out.exits = area.exits
    if (area.boss) out.boss = area.boss
    out.variants = variants
    areas.push(out)
  }

  // 문이 쌍으로 대칭인지 — 한쪽만 열린 문은 되돌아올 수 없는 길이 된다
  for (const area of stage.areas) {
    for (const exit of area.exits) {
      const [toArea, toExit] = exit.to.split(':')
      const dest = stage.areas.find((a) => a.id === toArea)
      if (!dest) {
        fail(`${stage.id}/${area.id}`, `'${exit.id}'의 목적지 구역 '${toArea}'가 없다`)
        continue
      }
      const pair = dest.exits.find((e) => e.id === toExit)
      if (!pair) {
        fail(`${stage.id}/${area.id}`, `'${exit.id}'의 짝 '${exit.to}'가 없다`)
        continue
      }
      if (pair.to !== `${area.id}:${exit.id}`) {
        fail(`${stage.id}/${area.id}`, `'${exit.id}'와 '${exit.to}'가 서로를 가리키지 않는다`)
      }
    }
  }

  const json = {
    id: stage.id,
    title: stage.title,
    objective: stage.objective,
    clearMessage: stage.clearMessage,
    size: { width: WIDTH, height: HEIGHT },
    variantCount: stage.variantCount,
    areas,
    script: scripts.get(stage.id),
  }
  writeFileSync(
    join(root, `src/data/stages/${stage.id}.json`),
    `${JSON.stringify(json, null, 2)}\n`,
  )
}

if (problems.length > 0) {
  console.error(`도면에 문제가 ${problems.length}건 있다:\n` + problems.map((p) => ` - ${p}`).join('\n'))
  process.exit(1)
}
console.log('스테이지 데이터를 다시 만들었다.')
