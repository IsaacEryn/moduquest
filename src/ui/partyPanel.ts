import type { Game } from '../core/game'
import type { JobData } from '../core/types'

const SLOT_LABELS = ['나의 직업', '동료 1', '동료 2']

function describeJob(j: JobData): string {
  const skills = j.skills
    .map((s) => {
      const when = (s.unlockLevel ?? 1) > 1 ? ` (${s.unlockLevel}레벨부터)` : ''
      return `${s.name}${when} — ${s.description}`
    })
    .join(' ')
  return (
    `${j.role}. ${j.playstyle ?? ''} ` +
    `체력 ${j.hp}, 공격 ${j.atk}, 방어 ${j.def}, 속도 ${j.spd}. 기술: ${skills}`
  )
}

/**
 * 파티 짜기 — 나와 동료 둘의 직업을 고른다.
 * 같은 직업은 파티에 하나만: 역할이 다른 셋이 모이는 것이 이 게임의 정체성이다.
 */
export class PartyPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true
  private selection: string[] = []

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
      <p class="intro">나와 동료 둘의 직업을 고르자. 같은 직업은 파티에 하나만 들어간다.</p>
      <div class="party-groups"></div>
      <div class="slot-actions">
        <button type="button" id="party-start">이 파티로 시작</button>
        <button type="button" id="party-close">돌아가기</button>
      </div>
    `
    document.body.append(this.dialog)

    // 직업 설명은 한 번만 만들어 모든 그룹이 참조한다
    const jobIds = Object.keys(this.game.jobs)
    const descWrap = document.createElement('div')
    descWrap.className = 'visually-hidden'
    for (const id of jobIds) {
      const p = document.createElement('p')
      p.id = `job-desc-${id}`
      p.textContent = describeJob(this.game.jobs[id])
      descWrap.append(p)
    }
    this.dialog.append(descWrap)

    const groups = this.dialog.querySelector('.party-groups')!
    SLOT_LABELS.forEach((label, slot) => {
      const fs = document.createElement('fieldset')
      const legend = document.createElement('legend')
      legend.textContent = label
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
          if (input.checked) {
            this.selection[slot] = id
            this.refreshDisabled()
          }
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

  /** 다른 자리에서 이미 고른 직업은 잠근다 — 중복이 생길 길 자체를 없앤다 */
  private refreshDisabled(): void {
    this.dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
      const slot = Number(input.name.split('-').at(-1))
      const pickedElsewhere = this.selection.some(
        (job, s) => s !== slot && job === input.value,
      )
      input.disabled = pickedElsewhere
    })
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.selection = [...this.game.currentPartyJobs]
    this.selection.forEach((job, slot) => {
      const input = this.dialog.querySelector<HTMLInputElement>(
        `#party-${slot}-${CSS.escape(job)}`,
      )
      if (input) input.checked = true
    })
    this.refreshDisabled()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('input:not([disabled])')?.focus()
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
