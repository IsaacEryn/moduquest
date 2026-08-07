import type { EventBus, GameEvent } from '../core/events'
import { DIR_KO } from '../core/field'
import type { Combatant } from '../core/types'
import { josa, toward } from '../core/korean'

// 다른 UI가 쓰던 자리를 유지한다 — 규칙 자체는 코어에 있다
export { josa, toward }
import type { Options } from './optionsStore'



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
    /**
     * 이 화면 앞에 앉은 사람의 파티원 id. "나"는 화면마다 다르다 —
     * 함께 하기에서 좌석 2번 사람은 힐러의 행동을 "내가"로 들어야 한다.
     * 솔로에서는 언제나 0번(기존과 동일).
     */
    private myId: () => string | null = () => null,
    /** 화면 앞의 사람이 앉은 자리 번호 — 길잡이·자리 이벤트의 1인칭 판정용 */
    private mySeat: () => number = () => 0,
  ) {
    bus.on((e) => this.handle(e))
  }

  /** 이 사람이 화면 앞의 "나"인가 — 좌석 기준, 솔로는 isPlayer 하위 호환 */
  private isMine(c: { id: string; isPlayer: boolean }): boolean {
    const mine = this.myId()
    return mine !== null ? c.id === mine : c.isPlayer
  }

  private who(c: Combatant): string {
    return this.isMine(c) ? '나' : c.name
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
        let text = `${toward(DIR_KO[e.dir])} 한 칸.`
        if (e.ahead) text += ` 앞에 ${e.ahead}.`
        this.polite(text)
        this.caption('[발소리]')
        break
      }
      case 'blocked':
        this.polite(`${josa(DIR_KO[e.dir], '은', '는')} 벽이다. 갈 수 없다.`)
        this.caption('[막힘]')
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
        const order = e.order.map((c) => this.who(c)).join(', ')
        this.polite(`행동 순서: ${order}.`)
        break
      }
      case 'playerTurn':
        // 함께 하기에서는 다른 자리의 차례도 이 이벤트로 온다 — 시점을 가른다
        if (e.actor.seat === undefined || e.actor.seat === this.mySeat()) {
          this.assertive('내 차례다. 행동을 고르자.')
        } else {
          this.polite(`${josa(e.actor.name, '이', '가')} 행동을 고르는 중.`)
        }
        this.caption('[차례 알림]')
        break
      case 'seatControlChanged':
        // 솔로에서는 나지 않는 이벤트 — 함께 하기의 합류와 이탈만 말한다
        if (e.controller === 'npc') {
          this.polite(
            e.seat === this.mySeat()
              ? '내 자리가 잠시 비었다.'
              : `${josa(e.memberName, '은', '는')} 이제 스스로 싸운다.`,
          )
        } else {
          this.polite(
            e.seat === this.mySeat()
              ? '내 자리로 돌아왔다.'
              : `${e.memberName}의 자리에 사람이 돌아왔다.`,
          )
        }
        break
      case 'signedIn':
        // 낭독은 로그인한 화면이 이미 이름과 함께 말한다 — 여기서는 소리의 자막만
        this.caption('[접속됨]')
        break
      case 'moveTokenChanged':
        this.polite(
          e.seat === this.mySeat()
            ? '이제 내가 길잡이다. 이동과 대화 넘김은 내 몫.'
            : `길잡이가 ${e.memberName}에게 넘어갔다.`,
        )
        break
      case 'attacked': {
        const target = this.isMine(e.target) ? '나' : e.target.name
        const left = e.target.hp > 0 ? ` 남은 체력 ${e.target.hp}.` : ''
        const verb = e.skillName ?? '공격'
        this.polite(`${this.who(e.actor)}의 ${verb}. ${target}에게 ${e.damage} 피해.${left}`)
        this.caption(e.skillName ? `[${e.skillName}]` : '[타격]')
        break
      }
      case 'healed': {
        const target = this.isMine(e.target) ? '내가' : josa(e.target.name, '이', '가')
        this.polite(
          `${this.who(e.actor)}의 치유. ${target} ${e.amount} 회복. 체력 ${e.target.hp}.`,
        )
        this.caption('[치유]')
        break
      }
      case 'taunted': {
        const actor = this.who(e.actor)
        this.polite(
          `${actor}의 도발. ${e.duration}라운드 동안 적이 ${josa(actor, '을', '를')} 노린다.`,
        )
        this.caption('[도발]')
        break
      }
      case 'defended':
        this.polite(`${josa(this.who(e.actor), '은', '는')} 방어 자세를 잡았다.`)
        this.caption('[방어]')
        break
      case 'deflected': {
        const target = this.isMine(e.target) ? '나는' : josa(e.target.name, '은', '는')
        this.polite(`${this.who(e.actor)}의 공격. ${target} 흘렸다. 피해 없음.`)
        this.caption('[흘림]')
        break
      }
      case 'traitChanged':
        this.polite(`특성을 ${toward(e.name)} 바꿨다. ${e.description}`)
        break
      case 'equipChanged': {
        const who = this.isMine({ id: e.memberId, isPlayer: e.isPlayer })
          ? '나는'
          : josa(e.memberName, '은', '는')
        if (e.itemName && e.removedName) {
          this.polite(
            `${who} ${josa(e.removedName, '을', '를')} 벗고 ${josa(e.itemName, '을', '를')} 입었다.`,
          )
        } else if (e.itemName) {
          this.polite(`${who} ${josa(e.itemName, '을', '를')} 입었다.`)
        } else if (e.removedName) {
          this.polite(`${who} ${josa(e.removedName, '을', '를')} 벗었다.`)
        }
        this.caption('[장비]')
        break
      }
      case 'manaSpent': {
        // 내 마력만 말한다 — 동료 것까지 매번 읽으면 전투가 숫자로 뒤덮인다.
        // 동료 마력은 둘러보기(전황 요약)에 들어 있다
        if (this.isMine(e.actor) && e.cost > 0) {
          this.polite(`마력 ${e.cost}를 썼다. ${e.left} 남았다.`)
        }
        break
      }
      case 'itemGained': {
        for (const name of e.names) {
          this.polite(`${josa(name, '을', '를')} 얻었다.`)
        }
        this.caption('[아이템]')
        break
      }
      case 'chestOpened': {
        const got = e.itemNames.map((n) => josa(n, '을', '를')).join(', ')
        this.polite(`보물상자를 열었다. ${got} 얻었다.`)
        this.caption('[상자 소리]')
        break
      }
      case 'itemUsed': {
        const target = this.isMine(e.target) ? '내가' : josa(e.target.name, '이', '가')
        const parts: string[] = [`${josa(e.name, '을', '를')} 썼다.`]
        if (e.healed > 0) parts.push(`${target} ${e.healed} 회복. 체력 ${e.target.hp}.`)
        if (e.mana > 0) parts.push(`${target} 마력 ${e.mana} 회복. 마력 ${e.target.mp}.`)
        if (e.cooldownCut > 0) {
          const who = this.isMine(e.target) ? '내' : `${e.target.name}의`
          parts.push(`${who} 기술 대기가 ${e.cooldownCut} 줄었다.`)
        }
        this.polite(parts.join(' '))
        this.caption('[아이템 사용]')
        break
      }
      case 'goldGained': {
        this.polite(`동전 ${e.amount}냥을 얻었다. 모두 ${e.total}냥.`)
        this.caption('[동전 소리]')
        break
      }
      case 'bought': {
        this.polite(`${josa(e.name, '을', '를')} ${e.price}냥에 샀다. 동전 ${e.gold}냥 남았다.`)
        this.caption('[동전 소리]')
        break
      }
      case 'sold': {
        this.polite(`${josa(e.name, '을', '를')} ${e.price}냥에 팔았다. 동전 ${e.gold}냥.`)
        this.caption('[동전 소리]')
        break
      }
      case 'dismantled': {
        this.polite(
          `${josa(e.name, '을', '를')} 분해해 강화 재료 ${e.gained}개를 얻었다. ` +
            `재료 ${e.materials}개.`,
        )
        this.caption('[분해 소리]')
        break
      }
      case 'upgraded': {
        this.polite(
          `${e.memberName}의 ${e.statName} 강화 ${e.level}단계. ` +
            `${josa(e.statName, '이', '가')} ${e.gain} 올랐다. ` +
            `동전 ${e.gold}냥, 재료 ${e.materials}개 남았다.`,
        )
        this.caption('[강화 소리]')
        break
      }
      case 'xpGained': {
        const next = e.toNext !== null ? ` 다음 레벨까지 ${e.toNext}.` : ''
        this.polite(`경험치 ${e.amount}를 얻었다.${next}`)
        break
      }
      case 'levelUp': {
        this.polite(`파티가 ${e.level}레벨이 되었다. 모두 강해졌다.`)
        for (const u of e.unlocked) {
          this.polite(`${josa(u.jobName, '이', '가')} 새 기술, ${josa(u.skillName, '을', '를')} 배웠다.`)
        }
        this.caption('[레벨 업]')
        break
      }
      case 'areaChanged': {
        const where =
          e.total > 1 ? `${e.areaName}. ${e.total}구역 중 ${e.index + 1}번째.` : `${e.areaName}.`
        const via = e.fromExitName ? ` ${josa(e.fromExitName, '을', '를')} 지나 왔다.` : ''
        this.polite(`${where}${via}`)
        this.caption('[구역 이동]')
        break
      }
      case 'stageStart':
        // 지금 어디쯤인지가 문장 안에 늘 있어야 한다
        this.polite(
          `스테이지 ${e.index + 1}. 셋 중 ${e.index + 1}번째. ${e.title}. 목표: ${e.objective}`,
        )
        break
      case 'downed': {
        if (e.target.side === 'enemy') {
          this.polite(`${josa(e.target.name, '을', '를')} 물리쳤다.`)
        } else if (this.isMine(e.target)) {
          this.polite('내가 쓰러졌다.')
        } else {
          this.polite(`${josa(e.target.name, '이', '가')} 쓰러졌다.`)
        }
        this.caption('[쓰러짐]')
        break
      }
      case 'victory': {
        this.assertive('이겼다! 파티가 조금 회복했다.')
        for (const c of e.revived) {
          this.polite(`쓰러졌던 ${josa(this.who(c), '이', '가')} 일어났다.`)
        }
        this.caption('[승리]')
        break
      }
      case 'defeat':
        this.assertive('파티가 쓰러졌다. 모두 회복하고 다시 시작한다.')
        this.caption('[패배]')
        break
      case 'stageClear':
        this.assertive(
          e.hasNext
            ? `스테이지 클리어! 셋 중 ${e.index + 1}을 끝냈다. 다음 스테이지로 갈 수 있다.`
            : '스테이지 클리어! 모든 스테이지를 끝냈다.',
        )
        this.caption('[축하 소리]')
        break
    }
  }
}
