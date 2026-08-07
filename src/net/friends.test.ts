import { describe, expect, it } from 'vitest'
import { splitFriendRows, type FriendRow } from './friends'

/**
 * 관계 행 하나가 신청이자 친구 사이라, 어느 칸에 놓을지는 "내가 청했는가"와
 * "수락됐는가"를 함께 봐야 정해진다. 이 판단이 뒤집히면 화면이 상대의 신청을
 * 내 신청으로 보여주고 수락 버튼이 사라진다 — 눈에 잘 안 띄고 치명적이다.
 */

const ME = 'me-uuid'
const YOU = 'you-uuid'

function row(over: Partial<FriendRow>): FriendRow {
  return {
    requester: ME,
    addressee: YOU,
    status: 'pending',
    from_profile: { nickname: '홍길동' },
    to_profile: { nickname: '이순신' },
    ...over,
  }
}

describe('친구 관계 가르기', () => {
  it('내가 청한 신청은 기다리는 칸에 있다', () => {
    const out = splitFriendRows([row({})], ME)
    expect(out.outgoing).toEqual([{ userId: YOU, nickname: '이순신' }])
    expect(out.incoming).toHaveLength(0)
    expect(out.friends).toHaveLength(0)
  })

  it('받은 신청은 수락할 수 있는 칸에 있다', () => {
    const out = splitFriendRows([row({ requester: YOU, addressee: ME })], ME)
    expect(out.incoming).toEqual([{ userId: YOU, nickname: '홍길동' }])
    expect(out.outgoing).toHaveLength(0)
  })

  it('수락된 사이는 방향과 무관하게 친구다', () => {
    const mine = splitFriendRows([row({ status: 'accepted' })], ME)
    const yours = splitFriendRows(
      [row({ requester: YOU, addressee: ME, status: 'accepted' })],
      ME,
    )
    expect(mine.friends).toEqual([{ userId: YOU, nickname: '이순신' }])
    expect(yours.friends).toEqual([{ userId: YOU, nickname: '홍길동' }])
  })

  it('상대의 이름을 보여준다 — 목록에 내 이름이 뜨면 누구인지 알 수 없다', () => {
    const out = splitFriendRows(
      [
        row({ status: 'accepted' }),
        row({
          requester: 'third',
          addressee: ME,
          status: 'accepted',
          from_profile: { nickname: '김유신' },
          to_profile: { nickname: '홍길동' },
        }),
      ],
      ME,
    )
    expect(out.friends.map((f) => f.nickname)).toEqual(['이순신', '김유신'])
  })

  it('닉네임이 비어 있어도 이름 없는 칸을 만들지 않는다', () => {
    const out = splitFriendRows([row({ status: 'accepted', to_profile: null })], ME)
    expect(out.friends[0].nickname).toBe('모험가')
  })
})
