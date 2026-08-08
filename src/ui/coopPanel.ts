import { currentProfile, signOut, type Profile } from '../net/auth'
import type { PartySession } from '../net/session'
import { AuthForm, errorLine, field } from './authForm'
import { hasSupabaseConfig } from '../net/supabaseClient'
import { josa } from './announcer'
import { toward } from '../core/korean'
import type { EventBus } from '../core/events'

type View = 'auth' | 'home' | 'room'

/**
 * 멀티 플레이의 문. 로그인(가입) → 파티로 하기/혼자 하기 → 로비까지 한 창에서.
 * 이 파일 전체가 동적 import로만 불린다 — 솔로 플레이는 이 코드를 읽지도 않는다.
 */
export class CoopPanel {
  private dialog: HTMLDialogElement
  private body: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private view: View = 'auth'
  private profile: Profile | null = null
  private busy = false
  /** 로그인·가입 폼 — 계정 창과 한 벌을 나눠 쓴다 */
  private authForm: AuthForm | null = null
  /**
   * 게스트가 고른 저장 자리 — 이 값이 곧 자동저장의 목적지다.
   * undefined는 아직 고르지 않았다는 뜻으로, 자리 목록이 오면 첫 빈 자리가 된다.
   * null은 사람이 직접 "저장하지 않는다"를 고른 것이라 그대로 존중한다.
   */
  private guestSlot: number | null | undefined = undefined
  /** 다시 그리기 직전에 손이 이 창 안에 있었는가 — 자리를 뺏을지 정하는 근거 */
  private handWasInside = false
  /** 그때 손이 무엇에 있었나 — 같은 것이 새로 서면 거기로 돌려준다 */
  private handKey: string | null = null
  /** 받은 초대 실시간 구독을 끊는 손잡이 */
  private unwatchInvites: (() => void) | null = null

  constructor(
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      announce: (text: string) => void
      /** 사건 통로 — 로그인 성공 같은 것이 소리·자막으로 이어진다 */
      bus?: EventBus
      /**
       * 누가 로그인해 있는가가 바뀌었다. 멀티 플레이의 저장 자리는 계정에 붙으므로,
       * main이 이 신호를 받아 저장소를 갈아 끼운다 — 화면은 그 사실을 모른다.
       */
      onProfileChanged?: (profile: Profile | null) => void | Promise<void>
      /** 세션을 만들거나 참가한다 — 실제 생성은 main이 한다(게임·데이터 접근) */
      createSession: (me: { userId: string; nickname: string }) => Promise<PartySession>
      joinSession: (code: string, me: { userId: string; nickname: string }) => Promise<PartySession>
      currentSession: () => PartySession | null
      /** 방장의 출발 — 저장 자리 화면을 열어 어느 자리로 갈지 고르게 한다 */
      hostStart: () => void
      /** 게스트의 저장 자리 — null이면 이번 모험을 저장하지 않는다 */
      setGuestSlot: (slot: number | null) => void
      describeSlots: () => Promise<{ label: string; empty: boolean }[]>
      /** 선물함 열기 — 세션과 무관한 비동기 우편 */
      openGifts: (me: Profile) => void
      /** 친구 목록 열기 */
      openFriends: (me: Profile) => void
      /** 계정 창 열기 — 닉네임·비밀번호·탈퇴는 그쪽이 담당한다 */
      openAccount?: () => void
      /** 고를 수 있는 직업들 — 목록도 이름도 데이터가 정한다 */
      jobList: () => { id: string; name: string; role: string }[]
      jobName: (id: string) => string
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options coop'
    this.dialog.setAttribute('aria-labelledby', 'coop-title')
    this.dialog.innerHTML = `
      <h2 id="coop-title">멀티 플레이</h2>
      <div class="coop-body"></div>
      <div class="slot-actions">
        <button type="button" id="coop-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.body = this.dialog.querySelector('.coop-body')!
    this.dialog.querySelector('#coop-close')!.addEventListener('click', () => this.requestClose())
    this.dialog.addEventListener('close', () => this.afterClose())
    this.dialog.addEventListener('cancel', (e) => {
      // ESC로도 모험단에서 조용히 빠지지 않게 — 닫기와 같은 길을 걷는다
      e.preventDefault()
      this.requestClose()
    })
  }

  /**
   * 프로필이 바뀌는 길은 셋(창 열기·로그인·로그아웃)뿐이고 전부 여기를 지난다.
   * 기다리는 이유는 저장소 교체가 서버 코드를 불러오는 일이라서다 — 끝나기 전에
   * 화면을 그리면 아직 이 기기의 자리를 읽어 계정 자리인 척 보여 준다.
   */
  private async setProfile(profile: Profile | null): Promise<void> {
    this.profile = profile
    await this.hooks.onProfileChanged?.(profile)
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(): Promise<void> {
    if (!hasSupabaseConfig()) {
      this.hooks.announce(
        '멀티 플레이 서버가 아직 연결되지 않았다. 지금은 싱글 플레이로 모험할 수 있다.',
      )
      return
    }
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.showModal()
    this.renderLoading('로그인 상태를 확인하는 중…')
    try {
      await this.setProfile(await currentProfile())
    } catch {
      await this.setProfile(null)
    }
    this.view = this.hooks.currentSession() ? 'room' : this.profile ? 'home' : 'auth'
    this.render()
  }

  /** 세션 로스터가 바뀔 때 main이 부른다 */
  refreshRoster(): void {
    if (this.dialog.open && this.view === 'room') this.render()
  }

  /** 모험이 시작됐다 — 로비는 물러난다 */
  onStarted(): void {
    this.close()
  }

  private requestClose(): void {
    const session = this.hooks.currentSession()
    if (session && !session.started) {
      // 로비에 있는 모험단을 떠난다 — 시작 전이니 잃을 것은 없다
      session.leave()
    }
    this.close()
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    this.unwatchInvites?.()
    this.unwatchInvites = null
    this.authForm?.destroy()
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }

  // --- 그리기 ---

  private renderLoading(text: string): void {
    this.body.replaceChildren()
    const p = document.createElement('p')
    p.textContent = text
    this.body.append(p)
  }

  /**
   * 다시 그린다.
   *
   * 로비는 누가 들고 날 때마다 다시 그려지므로, 손을 어떻게 다루는지가 중요하다.
   * 손이 어디 있었는지는 **지우기 전에** 봐야 안다 — 비우고 나면 이미 body로
   * 떨어져 있어서, 나중에 물으면 언제나 "밖에 있었다"가 된다.
   *
   * 뺏지 않는 것만으로는 모자랐다. 만지던 것이 사라지면 손은 갈 곳을 잃고
   * body에 남아, 키보드로 쓰는 사람은 다시 처음부터 탭해야 한다. 무엇을 만지고
   * 있었는지 적어 두었다가 같은 것이 새로 서면 그리로 돌려준다.
   */
  private render(): void {
    const active = document.activeElement
    this.handWasInside = this.dialog.contains(active)
    this.handKey = this.handWasInside ? handKeyOf(active) : null
    this.body.replaceChildren()
    if (this.view === 'auth') this.renderAuth()
    else if (this.view === 'home') this.renderHome()
    else this.renderRoom()
    if (this.handWasInside) this.restoreHand()
  }

  /** 다시 그리기 전에 만지던 것과 같은 자리를 찾아 손을 돌려준다 */
  private restoreHand(): void {
    if (this.dialog.contains(document.activeElement)) return
    const key = this.handKey
    if (!key) return
    const target =
      key === 'select'
        ? this.body.querySelector<HTMLElement>('select')
        : [...this.body.querySelectorAll<HTMLButtonElement>('button')].find(
            (b) => b.textContent?.trim() === key && !b.disabled,
          )
    target?.focus()
  }


  /**
   * 받은 모험단 초대 — 친구가 부르면 여기 뜬다. 코드를 옮겨 적을 필요가 없는
   * 지름길이라, 손이 불편하거나 코드 여덟 자를 옮기기 어려운 사람에게 특히 그렇다.
   */
  private async renderInvites(box: HTMLElement, me: Profile): Promise<void> {
    const { listPartyInvites, deletePartyInvite } = await import('../net/friends')
    let invites: Awaited<ReturnType<typeof listPartyInvites>>
    try {
      invites = await listPartyInvites()
    } catch {
      return
    }
    // 그 사이 화면이 바뀌었으면 남의 자리에 그리지 않는다
    if (!box.isConnected || this.view !== 'home') return
    box.replaceChildren()
    if (invites.length === 0) return

    const h = document.createElement('h3')
    h.textContent = '받은 초대'
    const list = document.createElement('ul')
    list.className = 'coop-roster'
    for (const invite of invites) {
      const li = document.createElement('li')
      const who = document.createElement('p')
      who.className = 'friend-name'
      who.textContent = `${invite.fromNickname}의 모험단`
      const row = document.createElement('div')
      row.className = 'friend-actions'

      const join = document.createElement('button')
      join.type = 'button'
      join.textContent = '참가하기'
      join.addEventListener('click', () => {
        if (this.busy) return
        this.busy = true
        join.disabled = true
        this.hooks
          .joinSession(invite.code, { userId: me.userId, nickname: me.nickname })
          .then(async () => {
            await deletePartyInvite(invite.id)
            this.guestSlot = undefined
            this.view = 'room'
            this.render()
            this.hooks.announce(`${invite.fromNickname}의 모험단에 들어왔다.`)
          })
          .catch((err: Error) => {
            this.hooks.announce(err.message)
            join.disabled = false
          })
          .finally(() => {
            this.busy = false
          })
      })

      const drop = document.createElement('button')
      drop.type = 'button'
      drop.className = 'alt-action'
      drop.textContent = '지우기'
      drop.addEventListener('click', () => {
        void deletePartyInvite(invite.id).then(() => {
          this.hooks.announce('초대를 지웠다.')
          void this.renderInvites(box, me)
        })
      })

      row.append(join, drop)
      li.append(who, row)
      list.append(li)
    }
    box.append(h, list)
    this.hooks.announce(
      invites.length === 1
        ? `${josa(invites[0].fromNickname, '이', '가')} 모험단으로 불렀다.`
        : `모험단 초대가 ${invites.length}개 와 있다.`,
    )
  }


  /** 로그인·가입 — 폼 한 벌(authForm)을 이 창의 몸통에 그린다 */
  private renderAuth(): void {
    this.authForm ??= new AuthForm({
      announce: this.hooks.announce,
      bus: this.hooks.bus,
      onSignedIn: async (profile) => {
        await this.setProfile(profile)
        this.hooks.announce(`${toward(profile.nickname)} 로그인했다.`)
        this.view = 'home'
        this.render()
      },
    })
    this.authForm.render(this.body)
  }

  /** 로그인 후 첫 화면 — 만들거나, 코드로 참가하거나 */
  private renderHome(): void {
    const me = this.profile!
    const hello = document.createElement('p')
    hello.className = 'intro'
    hello.textContent = `${me.nickname} — 어떻게 할까? 어느 쪽이든 기록은 계정에 남는다.`
    this.body.append(hello)

    /**
     * 파티로 하든 혼자 하든 여는 것은 같은 모험단이다. 혼자 시작해도 채널을 여는 것은
     * 나중에 동료가 초대 코드로 들어올 길을 닫지 않기 위해서다 — 이름만 다르고
     * 안에서 일어나는 일은 하나다.
     */
    const openParty = (btn: HTMLButtonElement, said: string) => {
      if (this.busy) return
      this.busy = true
      btn.disabled = true
      this.hooks
        .createSession({ userId: me.userId, nickname: me.nickname })
        .then(() => {
          this.view = 'room'
          this.render()
          this.hooks.announce(said)
        })
        .catch((err: Error) => this.hooks.announce(err.message))
        .finally(() => {
          this.busy = false
          btn.disabled = false
        })
    }

    const makeBtn = document.createElement('button')
    makeBtn.type = 'button'
    makeBtn.textContent = '모험단 만들기'
    makeBtn.addEventListener('click', () =>
      openParty(makeBtn, '모험단을 만들었다. 초대 코드를 동료에게 알리자.'),
    )

    const joinForm = document.createElement('form')
    joinForm.setAttribute('aria-label', '초대 코드로 참가')
    const code = field(joinForm, 'coop-code', '초대 코드 (8글자)', 'text', 'off')
    code.maxLength = 8
    code.style.textTransform = 'uppercase'
    const setError = errorLine(joinForm)
    const joinBtn = document.createElement('button')
    joinBtn.type = 'submit'
    joinBtn.textContent = '참가하기'
    joinForm.append(joinBtn)
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      this.busy = true
      joinBtn.disabled = true
      setError('')
      this.hooks.announce('모험단을 찾는 중…')
      this.hooks
        .joinSession(code.value, { userId: me.userId, nickname: me.nickname })
        .then(() => {
          // 새 모험단이다 — 지난 판의 저장 자리를 물려받지 않고 다시 고른다
          this.guestSlot = undefined
          this.view = 'room'
          this.render()
          this.hooks.announce('모험단에 들어왔다. 방장이 출발하기를 기다린다.')
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          joinBtn.disabled = false
        })
    })

    const gifts = document.createElement('button')
    gifts.type = 'button'
    gifts.textContent = '선물함'
    gifts.addEventListener('click', () => this.hooks.openGifts(me))

    const friends = document.createElement('button')
    friends.type = 'button'
    friends.textContent = '친구'
    friends.addEventListener('click', () => this.hooks.openFriends(me))

    const account = document.createElement('button')
    account.type = 'button'
    account.textContent = '내 정보'
    account.addEventListener('click', () => {
      this.close()
      this.hooks.openAccount?.()
    })

    const out = document.createElement('button')
    out.type = 'button'
    out.className = 'alt-action'
    out.textContent = '로그아웃'
    out.addEventListener('click', () => {
      void signOut().then(async () => {
        await this.setProfile(null)
        this.view = 'auth'
        this.render()
        this.hooks.announce('로그아웃했다.')
      })
    })

    // 만들기와 참가하기는 서로 다른 길이라 사이에 선을 긋는다.
    // 선물함·로그아웃은 모험과 무관한 일이라 맨 아래 한 줄로 묶는다
    const divider = document.createElement('p')
    divider.className = 'coop-divider'
    divider.textContent = '또는'

    const footer = document.createElement('div')
    footer.className = 'coop-row'
    footer.append(account, friends, gifts, out)

    /**
     * 두 갈래를 이름으로 가른다. 예전에는 "모험단 만들기"와 초대 코드 입력만 있어서,
     * 혼자 걷고 싶은 사람은 자기가 무엇을 눌러야 하는지 알 수 없었다 —
     * 혼자여도 출발할 수 있다는 안내가 로비 안쪽 버튼 뒤에나 있었다.
     */
    const choice = (title: string, desc: string, ...content: HTMLElement[]) => {
      const box = document.createElement('section')
      box.className = 'coop-choice'
      const h = document.createElement('h3')
      h.textContent = title
      const p = document.createElement('p')
      p.className = 'intro'
      p.textContent = desc
      box.append(h, p, ...content)
      box.setAttribute('aria-label', title)
      return box
    }

    const soloBtn = document.createElement('button')
    soloBtn.type = 'button'
    soloBtn.textContent = '혼자 시작하기'
    soloBtn.addEventListener('click', () =>
      openParty(soloBtn, '혼자 출발할 준비가 됐다. 동료는 초대 코드로 들어올 수 있다.'),
    )

    this.body.append(
      choice(
        '파티로 하기',
        '동료를 초대해 셋까지 함께 걷는다.',
        makeBtn,
        divider,
        joinForm,
      ),
      choice(
        '혼자 하기',
        '계정에 저장하며 혼자 걷는다. 동료는 나중에 초대 코드로 들어올 수 있다.',
        soloBtn,
      ),
      footer,
    )
    // 받은 초대는 코드를 옮겨 적을 필요 없는 지름길이라 맨 위에 둔다
    const invites = document.createElement('div')
    invites.className = 'coop-invites'
    hello.after(invites)
    void this.renderInvites(invites, me)
    // 친구가 부르면 이 자리에 바로 뜬다 — 창을 여닫아야 보이면 이미 늦은 부름이다
    this.watchInvites(invites, me)
    if (!this.handWasInside) makeBtn.focus()
  }

  /**
   * 받은 초대를 실시간으로 좇는다.
   *
   * 초대는 "지금 같이 걷자"는 부름이라 늦으면 뜻이 없다. 창을 열어 둔 채
   * 기다리는 사람에게는 오는 즉시 보여야 한다 — 목록을 다시 그리고, 새로 온
   * 것만 말한다. 이미 보고 있던 초대를 다시 읽으면 소음이 된다.
   */
  private watchInvites(box: HTMLElement, me: Profile): void {
    this.unwatchInvites?.()
    this.unwatchInvites = null
    void import('../net/friends').then(({ watchFriendActivity }) => {
      if (this.closed || !box.isConnected) return
      this.unwatchInvites = watchFriendActivity((what) => {
        if (what !== 'invites' || this.closed || !box.isConnected) return
        const before = new Set(
          [...box.querySelectorAll('.friend-name')].map((e) => e.textContent ?? ''),
        )
        void this.renderInvites(box, me).then(() => {
          for (const el of box.querySelectorAll('.friend-name')) {
            const text = el.textContent ?? ''
            if (!before.has(text)) this.hooks.announce(`${text}에 초대받았다.`)
          }
        })
      })
    })
  }

  /** 로비 — 코드, 자리, 출발 */
  /**
   * 방 안 화면. 누가 들고 나면 다시 그린다.
   *
   * **다시 그릴 때는 손을 뺏지 않는다.** 예전에는 그릴 때마다 방장은 출발 버튼,
   * 동료는 나가기 버튼으로 포커스를 옮겼는데, 로스터는 사람이 합류할 때마다
   * 갱신되므로 저장 자리를 고르던 손이 "모험단 나가기"로 튀었다 — 거기서 Enter를
   * 누르면 실제로 나가진다. 처음 열 때만 자리를 잡아 준다.
   */
  private renderRoom(): void {
    const session = this.hooks.currentSession()
    if (!session) {
      this.view = 'home'
      this.render()
      return
    }
    // 이 창 안에 이미 손이 있었으면 그대로 둔다(render가 지우기 전에 재 둔 값)
    const handInside = this.handWasInside

    const codeLine = document.createElement('p')
    codeLine.className = 'coop-code'
    codeLine.textContent = `초대 코드: ${session.code}`
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.textContent = '코드 복사'
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(session.code).then(
        () => this.hooks.announce('초대 코드를 복사했다.'),
        () => this.hooks.announce(`복사가 막혔다. 코드는 ${session.code}.`),
      )
    })

    const roster = document.createElement('ul')
    roster.className = 'coop-roster'
    roster.setAttribute('aria-label', '모험단 자리')
    for (const seat of [0, 1, 2] as const) {
      const li = document.createElement('li')
      const info = session.seats.find((s) => s.seat === seat)
      const role = seat === 0 ? '방장' : `${seat + 1}번 자리`
      const closed = session.closedSeats.includes(seat)
      const line = document.createElement('p')
      line.className = 'seat-line'
      if (info) {
        const who = info.userId === session.userId ? `${info.nickname} (나)` : info.nickname
        // 무엇으로 걷기로 했는지도 함께 적는다 — 파티가 어떻게 서는지는
        // 출발 전에 서로 보이는 편이 낫다(탱커가 없으면 누군가 바꾸게 된다)
        const job = info.job ? this.hooks.jobName(info.job) : '아직 안 골랐다'
        // 준비는 동료 자리에만 적는다 — 방장에게는 출발 버튼을 누르는 것이 곧 준비다
        const ready =
          seat === 0 || info.controller !== 'human'
            ? ''
            : info.ready
              ? ' · 준비완료'
              : ' · 고르는 중'
        line.textContent =
          `${role} — ${who}${info.controller === 'npc' ? ' (잠시 자리 비움)' : ''} · ${job}${ready}`
      } else if (closed) {
        line.textContent = `${role} — 컴퓨터가 맡는다`
      } else {
        line.textContent = `${role} — 사람을 기다린다`
      }
      li.append(line)

      // 빈 자리를 어떻게 할지는 방장이 정한다. 둘이서만 걷기로 했으면
      // 코드를 아는 사람도 못 들어와야 그 결정이 지켜진다
      if (session.isHost && seat !== 0 && !info) {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'alt-action seat-toggle'
        toggle.textContent = closed ? '사람에게 열기' : '컴퓨터에게 맡기기'
        toggle.addEventListener('click', () => {
          if (!session.setSeatOpen(seat, closed)) return
          this.hooks.announce(
            closed
              ? `${role}를 사람에게 열었다. 초대 코드로 들어올 수 있다.`
              : `${role}는 컴퓨터가 맡는다. 이제 이 자리에는 들어올 수 없다.`,
          )
          this.render()
        })
        li.append(toggle)
      }
      roster.append(li)
    }

    // 코드 줄과 복사 버튼은 한 몸이라 붙여 둔다.
    // 친구 부르기는 코드를 읽어 주지 않아도 되는 다른 길이라 나란히 둔다
    const callFriend = document.createElement('button')
    callFriend.type = 'button'
    callFriend.className = 'alt-action'
    callFriend.textContent = '친구 부르기'
    callFriend.addEventListener('click', () => this.hooks.openFriends(this.profile!))

    const codeRow = document.createElement('div')
    codeRow.className = 'coop-code-row'
    codeRow.append(codeLine, copy, callFriend)
    this.body.append(codeRow, roster)

    if (session.isHost) {
      // 새로 갈지 이어서 갈지는 저장 자리 화면이 자리를 보고 정한다 —
      // 예전에는 여기서 먼저 정해야 해서, 빈 칸뿐인데 "저장된 기록에서 출발"을
      // 고르면 전부 비활성인 화면을 만났다
      const note = document.createElement('p')
      note.className = 'intro'
      note.textContent =
        '혼자여도 출발할 수 있다. 동료는 모험 중에도 초대 코드로 합류한다.'
      const start = document.createElement('button')
      start.type = 'button'
      /*
        아직 고르는 중인 사람이 있으면 잠근다. 출발하면 직업을 바꿀 수 없으니,
        누군가 고르는 동안 떠나 버리면 그 사람은 남이 정해 준 것으로 걷게 된다.

        **왜 못 누르는지는 버튼이 스스로 말한다.** 이유 없이 회색인 버튼은
        고장으로 읽히고, 그러면 기다리는 대신 새로고침을 하게 된다 —
        이 규칙은 마을·전투·특성 화면이 이미 같은 꼴로 지키고 있다.
      */
      const waiting = session.notReady
      start.disabled = waiting.length > 0
      start.textContent = waiting.length
        ? `출발하기 (${waiting.join(', ')}이(가) 고르는 중)`
        : '출발하기'
      start.addEventListener('click', () => this.hooks.hostStart())
      // 안내가 버튼보다 먼저 온다 — 무엇을 누르는지 알고 나서 누르도록
      this.body.append(note, start)
      if (!handInside) start.focus()
    } else {
      const wait = document.createElement('p')
      wait.className = 'intro'
      wait.textContent = '방장이 출발하면 함께 시작된다.'

      // 무엇으로 싸울지는 내가 고른다 — 특성도 가방도 자리마다 갈라 두었는데
      // 직업만 방장이 정해 주고 있었다
      this.body.append(wait, this.jobPicker(session))

      /*
        준비 신호. 방장은 이것이 올라오기 전까지 출발하지 않는다.

        되돌릴 수 있게 둔 것은, 눌러 놓고 마음이 바뀌는 일이 흔하기 때문이다 —
        한 번 누르면 못 무르는 문은 고르는 사람을 서두르게 만든다.
      */
      const me = session.seats.find((s) => s.userId === session.userId)
      const ready = Boolean(me?.ready)
      const readyBtn = document.createElement('button')
      readyBtn.type = 'button'
      readyBtn.className = ready ? 'alt-action' : ''
      readyBtn.textContent = ready ? '다시 고를래' : '준비완료'
      readyBtn.addEventListener('click', () => {
        if (!session.setReady(!ready)) return
        this.hooks.announce(ready ? '준비를 물렀다.' : '준비를 마쳤다. 방장이 출발할 수 있다.')
        this.render()
      })
      this.body.append(readyBtn)

      // 이 모험을 내 기록 어디에 남길지 — 같은 세계를 각자의 자리에 저장한다
      const row = document.createElement('p')
      row.className = 'form-row'
      const label = document.createElement('label')
      label.htmlFor = 'coop-slot'
      label.textContent = '내 저장 자리'
      const select = document.createElement('select')
      select.id = 'coop-slot'
      const none = document.createElement('option')
      none.value = ''
      none.textContent = '저장하지 않는다'
      select.append(none)
      // 화면에 보이는 것이 곧 실제 설정이게 한다. 예전에는 change에서만 전달해서,
      // 손대지 않으면 직전 솔로 플레이의 자리가 그대로 남아 "저장하지 않는다"고
      // 적혀 있는 채로 그 자리를 덮어썼다. 로스터가 바뀌어 이 화면을 다시 그려도
      // 고른 값은 패널이 기억한다
      void this.hooks.describeSlots().then((slots) => {
        slots.forEach((s, i) => {
          const o = document.createElement('option')
          o.value = String(i)
          o.textContent = s.label
          select.append(o)
        })
        // 아직 아무것도 고르지 않았다면 첫 빈 자리가 기본이다.
        // "저장은 각자 자기 자리에 남는다"고 약속해 놓고 기본값이 반대면,
        // 드롭다운을 지나친 사람의 모험이 조용히 사라진다 — 실제로 그랬다.
        // 빈 자리가 없을 때만 "저장하지 않는다"로 두어 기록을 덮지 않는다
        if (this.guestSlot === undefined) {
          const empty = slots.findIndex((s) => s.empty)
          this.guestSlot = empty === -1 ? null : empty
        }
        select.value = this.guestSlot === null ? '' : String(this.guestSlot)
        this.hooks.setGuestSlot(this.guestSlot)
      })
      select.addEventListener('change', () => {
        const v = select.value === '' ? null : Number(select.value)
        this.guestSlot = v
        this.hooks.setGuestSlot(v)
        this.hooks.announce(
          v === null ? '이번 모험은 저장하지 않는다.' : `${v + 1}번 자리에 저장하며 간다.`,
        )
      })
      row.append(label, select)

      const leaveBtn = document.createElement('button')
      leaveBtn.type = 'button'
      leaveBtn.textContent = '모험단 나가기'
      leaveBtn.addEventListener('click', () => {
        session.leave()
        this.view = 'home'
        this.render()
      })
      const leaveRow = document.createElement('div')
      leaveRow.className = 'coop-row'
      leaveBtn.className = 'alt-action'
      leaveRow.append(leaveBtn)
      this.body.append(row, leaveRow)
      if (!handInside) leaveBtn.focus()
    }
  }

  /**
   * 내 직업 고르기 — 동료 자리에만 선다.
   *
   * 방장은 파티 짜기 화면에서 자기 것과 컴퓨터 자리를 고르므로 여기 두지 않는다.
   * 겹침은 막지 않는다 — 셋 다 힐러여도 그들의 모험이라는 규칙이 이미 있다.
   */
  private jobPicker(session: PartySession): HTMLElement {
    const box = document.createElement('fieldset')
    box.className = 'trait-group'
    const legend = document.createElement('legend')
    legend.textContent = '내 직업'
    const note = document.createElement('p')
    note.className = 'trait-cat-note'
    note.textContent = '출발하기 전까지 바꿀 수 있다. 같은 직업이 겹쳐도 된다.'
    box.append(legend, note)

    const mine = session.seats.find((s) => s.userId === session.userId)
    for (const job of this.hooks.jobList()) {
      const row = document.createElement('p')
      row.className = 'party-choice'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'coop-job'
      input.id = `coop-job-${job.id}`
      input.checked = mine?.job === job.id
      input.addEventListener('change', () => {
        if (!session.pickJob(job.id)) return
        this.hooks.announce(`${toward(job.name)} 간다.`)
        this.render()
      })
      const label = document.createElement('label')
      label.htmlFor = input.id
      label.textContent = `${job.name} (${job.role})`
      row.append(input, label)
      box.append(row)
    }
    return box
  }
}

/** 손이 무엇에 있었는지를 한 조각 글로 — 셀렉트는 하나뿐이라 종류로 족하다 */
function handKeyOf(el: Element | null): string | null {
  if (!(el instanceof HTMLElement)) return null
  if (el.tagName === 'SELECT') return 'select'
  if (el.tagName === 'BUTTON') return el.textContent?.trim() || null
  return null
}
