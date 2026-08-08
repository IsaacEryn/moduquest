import type { Game } from '../core/game'
import { josa } from './announcer'
import type { JobData } from '../core/types'

const SLOT_LABELS = ['나의 직업', '동료 1', '동료 2']
// 문장의 주어 꼴 — "동료 1"의 1은 '일'로 읽혀 받침이 있으므로 조사가 다르다
const SLOT_SUBJECTS = ['내가', '동료 1이', '동료 2가']

function describeJob(j: JobData): string {
  const skills = j.skills
    .map((s) => {
      const when = (s.unlockLevel ?? 1) > 1 ? ` (${s.unlockLevel}레벨부터)` : ''
      const cost = s.mpCost ? ` 마력 ${s.mpCost}` : ''
      return `${s.name}${when} —${cost} ${s.description}`
    })
    .join(' ')
  return (
    `${j.role}. ${j.playstyle ?? ''} ` +
    // 누가 앞에 서는지는 파티를 짤 때 알아야 하는 정보다
    `앞줄 ${j.frontOrder}번째. ` +
    `체력 ${j.hp}, 마력 ${j.mp}(라운드마다 ${j.mpRegen} 회복), ` +
    // 무엇으로 싸우는가가 먼저다 — 파티를 짤 때 물리와 마법이 섞였는지 보게 한다
    `${j.mainType === 'magic' ? '마법으로 싸운다' : '몸으로 싸운다'}. ` +
    `공격 물리 ${j.patk} · 마법 ${j.matk}, 방어 물리 ${j.pdef} · 마법 ${j.mdef}, ` +
    `속도 ${j.spd}. 기술: ${skills}`
  )
}

/**
 * 파티 짜기 — 나와 동료 둘의 직업을 고른다.
 *
 * 예전에는 다른 자리가 고른 직업을 잠갔다. 그러면 동료에게 배정된 직업을 내가
 * 가지려면 동료부터 바꿔야 해서 순서가 강요됐고, 잠긴 라디오는 화살표 이동까지
 * 끊어 접근성도 나빴다. 지금은 아무 칸도 잠그지 않는다 — 겹치게 고르면 겹친
 * 자리가 내 이전 직업을 대신 맡아 비켜 준다.
 *
 * 멀티 플레이는 겹침 자체를 허용한다. 셋 다 힐러여도 그들의 모험이다.
 */
export class PartyPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true
  private selection: string[] = []
  /** 같은 직업을 여러 자리에 허용하는가 — 멀티 플레이에서 켠다 */
  private allowDuplicates = false
  private status!: HTMLElement
  /** 자리 이름표 — 누가 그 자리에 앉는지를 열 때마다 다시 적는다 */
  private legends: HTMLElement[] = []
  /** 자리별 라디오 묶음 — 남이 고른 자리를 잠글 때 쓴다 */
  private fieldsets: HTMLFieldSetElement[] = []

  constructor(
    private game: Game,
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      onConfirm: (jobs: string[]) => void
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options party'
    this.dialog.setAttribute('aria-labelledby', 'party-title')
    this.dialog.innerHTML = `
      <h2 id="party-title">파티 짜기</h2>
      <p class="intro" id="party-intro"></p>
      <div class="party-groups"></div>
      <p class="party-status" role="status"></p>
      <div class="slot-actions">
        <button type="button" id="party-start">이 파티로 시작</button>
        <button type="button" id="party-close">돌아가기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.status = this.dialog.querySelector('.party-status')!

    // 직업 설명은 한 번만 만들어 모든 그룹이 참조한다.
    // 눈으로 고르는 사람에게도 보여야 한다 — 숨기면 스크린리더 사용자만 스탯을 알게 된다.
    // 접어 두는 것은 라디오 열다섯 개가 밀려나지 않게 하려는 것이고, 펼치면 전부 나온다
    const jobIds = Object.keys(this.game.jobs)
    const descWrap = document.createElement('details')
    descWrap.className = 'job-descs'
    const summary = document.createElement('summary')
    summary.textContent = '직업 자세히 보기'
    descWrap.append(summary)
    for (const id of jobIds) {
      const p = document.createElement('p')
      p.id = `job-desc-${id}`
      p.className = 'slot-desc'
      p.textContent = `${this.game.jobs[id].name} — ${describeJob(this.game.jobs[id])}`
      descWrap.append(p)
    }
    const actions = this.dialog.querySelector('.slot-actions')!
    actions.before(descWrap)

    const groups = this.dialog.querySelector('.party-groups')!
    SLOT_LABELS.forEach((label, slot) => {
      const fs = document.createElement('fieldset')
      const legend = document.createElement('legend')
      legend.textContent = label
      this.legends[slot] = legend
      this.fieldsets[slot] = fs
      fs.append(legend)
      for (const id of jobIds) {
        const j = this.game.jobs[id]
        const wrap = document.createElement('div')
        wrap.className = 'party-choice'
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = `party-slot-${slot}`
        input.id = `party-${slot}-${id}`
        input.value = id
        input.setAttribute('aria-describedby', `job-desc-${id}`)
        input.addEventListener('change', () => {
          if (!input.checked) return
          const prev = this.selection[slot]
          if (!this.allowDuplicates && prev !== id) {
            // 겹친 자리가 내 이전 직업을 대신 맡는다 — 순서를 강요하지 않는 교환
            const other = this.selection.findIndex((job, s) => s !== slot && job === id)
            if (other !== -1) {
              this.selection[other] = prev
              this.checkRadio(other, prev)
              const jobName = this.game.jobs[prev]?.name ?? prev
              this.status.textContent =
                `${SLOT_SUBJECTS[other]} ${josa(jobName, '을', '를')} 대신 맡았다.`
            } else {
              this.status.textContent = ''
            }
          }
          this.selection[slot] = id
        })
        const lab = document.createElement('label')
        lab.htmlFor = input.id
        lab.textContent = `${j.name} (${j.role})`
        wrap.append(input, lab)
        fs.append(wrap)
      }
      groups.append(fs)
    })

    this.dialog.querySelector('#party-start')!.addEventListener('click', () => {
      const jobs = [...this.selection]
      this.close()
      this.hooks.onConfirm(jobs)
    })
    this.dialog.querySelector('#party-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  /**
   * 자리마다 누가 앉는지를 이름표에 적는다. 함께 하기에서 동료 자리가 사람인지
   * 컴퓨터인지 모르는 채로 직업을 고르면, 방장이 남의 몫을 대신 정해 버리거나
   * 반대로 아무도 맡지 않을 자리를 오래 고민하게 된다.
   * 혼자 할 때는 적지 않는다 — 동료가 컴퓨터인 것은 그 자체로 자명하다.
   */
  private labelSeats(owners?: (string | null)[]): void {
    SLOT_LABELS.forEach((label, slot) => {
      const legend = this.legends[slot]
      if (!legend) return
      if (!owners || slot === 0) {
        legend.textContent = label
        return
      }
      legend.textContent = owners[slot]
        ? `${label} — ${owners[slot]}`
        : `${label} — 컴퓨터가 맡는다`
    })
  }

  private checkRadio(slot: number, job: string): void {
    const input = this.dialog.querySelector<HTMLInputElement>(
      `#party-${slot}-${CSS.escape(job)}`,
    )
    if (input) input.checked = true
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(
    opts: {
      allowDuplicates?: boolean
      seatOwners?: (string | null)[]
      /** 그 자리 사람이 스스로 고른 직업 — 있으면 방장은 손대지 못한다 */
      pickedJobs?: (string | null)[]
    } = {},
  ): void {
    this.closed = false
    this.allowDuplicates = opts.allowDuplicates ?? false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.status.textContent = ''
    this.labelSeats(opts.seatOwners)
    this.dialog.querySelector('#party-intro')!.textContent = this.allowDuplicates
      ? '나와 동료 둘의 직업을 고르자. 함께 하기에서는 같은 직업이 겹쳐도 된다.'
      : '나와 동료 둘의 직업을 고르자. 겹치게 고르면 그 자리가 내 이전 직업을 대신 맡는다.'
    this.selection = [...this.game.currentPartyJobs]
    /*
      동료가 로비에서 스스로 고른 자리는 그 선택을 그대로 세우고 잠근다.
      무엇으로 싸울지는 그 사람이 그 판을 어떻게 겪을지를 정하는 첫 선택이라
      방장이 대신 고칠 자리가 아니다 — 잠근 이유는 이름표에 적어 둔다.
    */
    opts.pickedJobs?.forEach((job, slot) => {
      if (job) this.selection[slot] = job
    })
    this.selection.forEach((job, slot) => this.checkRadio(slot, job))
    this.lockPicked(opts.pickedJobs)
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('input:not([disabled])')?.focus()
  }

  /** 남이 고른 자리의 라디오를 잠근다 */
  private lockPicked(picked?: (string | null)[]): void {
    this.fieldsets.forEach((fs, slot) => {
      const locked = Boolean(picked?.[slot])
      for (const input of fs.querySelectorAll('input')) input.disabled = locked
      const legend = this.legends[slot]
      if (locked && legend && !legend.textContent?.includes('골랐다')) {
        legend.textContent = `${legend.textContent} — 직접 골랐다`
      }
    })
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }
}
