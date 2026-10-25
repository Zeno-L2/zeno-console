import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { ZenonService } from '../zenon-service'
import type { TxTrackerService } from '../tx-tracker-service'
import { useNetwork } from './useNetwork'
import { useTxTracker } from './useTxTracker'

const HASH = 'ab'.repeat(32)

function setup() {
  const stop = vi.fn()
  const follow = vi.fn<(hash: string, onState: unknown) => () => void>(() => stop)
  const tracker = { follow } as unknown as TxTrackerService
  let api!: ReturnType<typeof useTxTracker>
  const w = mount(
    defineComponent({
      setup() {
        api = useTxTracker(tracker)
        return () => h('div')
      },
    })
  )
  return { api, follow, stop, w }
}

describe('useTxTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useNetwork().isChecking.value = false
  })

  async function switchNode(url: string, mock: { mockReturnValue(v: string): unknown }) {
    const { isChecking } = useNetwork()
    isChecking.value = true
    await nextTick()
    mock.mockReturnValue(url)
    isChecking.value = false
    await nextTick()
  }

  it('follows the send again after the node changes', async () => {
    const getNodeUrl = vi.spyOn(ZenonService.getInstance(), 'getNodeUrl').mockReturnValue('ws://a')
    const { api, follow, stop, w } = setup()
    api.track(HASH)
    expect(follow).toHaveBeenCalledTimes(1)
    api.state.value = { sendHash: HASH } as never
    await switchNode('ws://b', getNodeUrl)
    expect(follow).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(api.state.value).toBeNull()
    w.unmount()
  })

  it('does not follow again when the node did not change', async () => {
    const getNodeUrl = vi.spyOn(ZenonService.getInstance(), 'getNodeUrl').mockReturnValue('ws://a')
    const { api, follow, w } = setup()
    api.track(HASH)
    await switchNode('ws://a', getNodeUrl)
    expect(follow).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('does not follow again after the send is untracked', async () => {
    const getNodeUrl = vi.spyOn(ZenonService.getInstance(), 'getNodeUrl').mockReturnValue('ws://a')
    const { api, follow, w } = setup()
    api.track(HASH)
    api.untrack()
    await switchNode('ws://b', getNodeUrl)
    expect(follow).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
