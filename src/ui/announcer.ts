import type { EventBus, GameEvent } from '../core/events'
import { DIR_KO } from '../core/field'
import type { Combatant } from '../core/types'
import type { Options } from './optionsStore'

/** 받침 유무에 따라 조사를 고른다 (을/를, 이/가, 은/는). "슬라임 1"처럼 숫자로 끝나는 이름도 처리 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const lastChar = word[word.length - 1]
  let hasFinal: boolean
  if (/[0-9]/.test(lastChar)) {
    // 영·일·삼·육·칠·팔로 읽히는 숫자는 받침이 있다
    hasFinal = '013678'.includes(lastChar)
  } else {
    const code = word.charCodeAt(word.length - 1)
    hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 > 0
  }
  return `${word}${hasFinal ? withFinal : withoutFinal}`
}

function who(c: Combatant): string {
  return c.isPlayer ? '나' : c.name
}

const ZWSP = '\u200B'
const CAPTION_HOLD_MS = 2000

/**
 * 게임 이벤트를 낭독 문장으로 바꿔 live region에 싣는다.
 * 문구 규칙은 09-a11y-spec의 표를 따르고, 문자열은 전부 이 모듈에만 둔다.
 *
 * 같은 턴에 여러 문장이 나오면(공격→처치 등) 나중 문장이 앞 문장을 덮어써
 * 낭독이 유실되므로, 한 동기 배치의 문장을 채널별로 모아 한 번에 싣는다.
 */
export class Announcer {
  private log = document.querySelector<HTMLElement>('#sr-log')!
  private alert = document.querySelector<HTMLElement>('#sr-alert')!
  private captionEl = document.querySelector<HTMLElement>('#captions')!
  private pending = new Map<HTMLElement, string[]>()
  private flushScheduled = false
  private captionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    bus: EventBus,
    private options: Options,
    private onLine?: (text: string) => void,
  ) {
    bus.on((e) => this.handle(e))
  }

  polite(text: string): void {
    this.enqueue(this.log, text)
  }

  assertive(text: string): void {
    this.enqueue(this.alert, text)
  }

  private enqueue(el: HTMLElement, text: string): void {
    const queue = this.pending.get(el) ?? []
    queue.push(text)
    this.pending.set(el, queue)
    this.onLine?.(text)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      setTimeout(() => this.flush(), 0)
    }
  }

  private flush(): void {
    this.flushScheduled = false
    for (const [el, queue] of this.pending) {
      if (queue.length === 0) continue
      const text = queue.join(' ')
      queue.length = 0
      // 직전과 같은 문구라면 보이지 않는 문자를 붙였다 뗐다 하며 항상 변경을 만든다
      const prev = (el.textContent ?? '').replaceAll(ZWSP, '')
      el.textContent = prev === text && el.textContent === text ? text + ZWSP : text
    }
  }

  private caption(text: string): void {
    if (!this.options.captions) return
    this.captionEl.textContent = text
    // 자막은 "지금 나는 소리" — 잠시 뒤에 지운다
    if (this.captionTimer) clearTimeout(this.captionTimer)
    this.captionTimer = setTimeout(() => {
      this.captionEl.textContent = ''
    }, CAPTION_HOLD_MS)
  }

  private clearCaption(): void {
    if (this.captionTimer) clearTimeout(this.captionTimer)
    this.captionEl.textContent = ''
  }

  private handle(e: GameEvent): void {
    switch (e.type) {
      case 'mode':
        this.clearCaption()
        break
      case 'moved': {
        let text = `${josa(DIR_KO[e.dir], '으로', '로')} 한 칸.`
        if (e.ahead) text += ` 앞에 ${e.ahead}.`
        this.polite(text)
        break
      }
      case 'blocked':
        this.polite(`${josa(DIR_KO[e.dir], '은', '는')} 벽이다. 갈 수 없다.`)
        break
      case 'fieldSummary':
      case 'battleSummary':
        this.polite(e.text)
        break
      case 'checkpoint':
        this.polite('쉼터에 도착했다. 여기서 다시 시작할 수 있다.')
        this.caption('[포근한 소리]')
        break
      case 'dialogue':
        this.polite(`${e.line.speaker}: ${e.line.text}`)
        break
      case 'battleStart': {
        const names = e.enemies.map((m) => m.name).join(', ')
        this.assertive(`전투 시작! 상대는 ${names}.`)
        this.caption('[전투 시작]')
        const order = e.order.map((c) => who(c)).join(', ')
        this.polite(`행동 순서: ${order}.`)
        break
      }
      case 'playerTurn':
        this.assertive('내 차례다. 행동을 고르자.')
        break
      case 'attacked': {
        const target = e.target.isPlayer ? '나' : e.target.name
        const left = e.target.hp > 0 ? ` 남은 체력 ${e.target.hp}.` : ''
        this.polite(`${who(e.actor)}의 공격. ${target}에게 ${e.damage} 피해.${left}`)
        this.caption('[타격]')
        break
      }
      case 'healed': {
        const target = e.target.isPlayer ? '내가' : josa(e.target.name, '이', '가')
        this.polite(
          `${who(e.actor)}의 치유. ${target} ${e.amount} 회복. 체력 ${e.target.hp}.`,
        )
        this.caption('[치유]')
        break
      }
      case 'taunted': {
        const actor = who(e.actor)
        this.polite(
          `${actor}의 도발. ${e.duration}라운드 동안 적이 ${josa(actor, '을', '를')} 노린다.`,
        )
        this.caption('[도발]')
        break
      }
      case 'defended':
        this.polite(`${josa(who(e.actor), '은', '는')} 방어 자세를 잡았다.`)
        break
      case 'deflected': {
        const target = e.target.isPlayer ? '나는' : josa(e.target.name, '은', '는')
        this.polite(`${who(e.actor)}의 공격. ${target} 흘렸다. 피해 없음.`)
        this.caption('[흘림]')
        break
      }
      case 'traitChanged':
        this.polite(`특성을 ${e.name}으로 바꿨다. ${e.description}`)
        break
      case 'downed': {
        if (e.target.side === 'enemy') {
          this.polite(`${josa(e.target.name, '을', '를')} 물리쳤다.`)
        } else if (e.target.isPlayer) {
          this.polite('내가 쓰러졌다.')
        } else {
          this.polite(`${josa(e.target.name, '이', '가')} 쓰러졌다.`)
        }
        break
      }
      case 'victory': {
        this.assertive('이겼다! 파티가 조금 회복했다.')
        for (const c of e.revived) {
          this.polite(`쓰러졌던 ${josa(who(c), '이', '가')} 일어났다.`)
        }
        this.caption('[승리]')
        break
      }
      case 'defeat':
        this.assertive('파티가 쓰러졌다. 모두 회복하고 다시 시작한다.')
        break
      case 'stageClear':
        this.assertive('스테이지 클리어!')
        this.caption('[축하 소리]')
        break
    }
  }
}
