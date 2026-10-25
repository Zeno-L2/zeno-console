import { afterAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { DEFAULT_GATEWAY_URL } from '../../config'
import { GatewayService } from '../gateway-service'
import { useGateway } from './useGateway'
import { useSettings } from './useSettings'

const Caller = defineComponent({
  setup() {
    useGateway()
    return () => h('div')
  },
})

describe('useGateway', () => {
  afterAll(async () => {
    await useSettings().reset()
  })

  it('keeps pointing the service at the saved gateway URL after its first caller unmounts', async () => {
    const wrapper = mount(Caller)
    expect(GatewayService.getInstance().getUrl()).toBe(DEFAULT_GATEWAY_URL)
    wrapper.unmount()

    await useSettings().update({ gatewayUrl: 'http://gateway.example:1234' })
    await Promise.resolve()

    expect(GatewayService.getInstance().getUrl()).toBe('http://gateway.example:1234')
  })
})
