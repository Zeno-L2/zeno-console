import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DomainInconsistentError, GatewayVerificationError, UnknownDomainError } from 'zeno-client'
import type { Head } from 'zeno-client'
import { call } from '../../test/replay-client'
import ListNotices from './ListNotices.vue'

const head = (over: Record<string, unknown> = {}) => ({ ...(call('getHead').response.result as object), ...over }) as unknown as Head

const base = { domainId: 4, tag: 'latest', answeredTag: 'latest', head: null, cause: null, error: null } as const

const render = (props: Record<string, unknown> = {}) => mount(ListNotices, { props: { ...base, ...props } as never })

describe('ListNotices', () => {
  it('renders nothing when the read is fine', () => {
    const w = render()
    expect(w.find('[data-slot="tag-fallback"], [data-slot="inconsistent-banner"], [data-slot="unknown-domain"], [data-slot="failed-check"], [role="alert"]').exists()).toBe(false)
  })

  it('says the latest accepted state is shown when pending fell back to latest', () => {
    const w = render({ tag: 'pending', answeredTag: 'latest' })
    expect(w.find('[data-slot="tag-fallback"]').text()).toContain('This gateway does not serve pending state.')
  })

  it('shows no fallback note when the selected tag answered', () => {
    expect(render({ tag: 'pending', answeredTag: 'pending' }).find('[data-slot="tag-fallback"]').exists()).toBe(false)
  })

  it('leaves the INCONSISTENT head banner to the layout', () => {
    const w = render({ head: head({ status: 'INCONSISTENT', inconsistentAt: 2 }) })
    expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(false)
  })

  it('shows no banner for a DomainInconsistentError while the head is INCONSISTENT', () => {
    const cause = new DomainInconsistentError('domain inconsistent', -32010)
    const w = render({ cause, error: 'domain inconsistent', head: head({ status: 'INCONSISTENT', inconsistentAt: 2 }) })
    expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(false)
  })

  it('shows the banner with the error text for a DomainInconsistentError, and no plain alert', () => {
    const cause = new DomainInconsistentError('domain inconsistent', -32010)
    const w = render({ cause, error: 'domain inconsistent' })
    expect(w.find('[data-slot="inconsistent-banner"]').text()).toContain('domain inconsistent')
    expect(w.find('p[role="alert"]').exists()).toBe(false)
  })

  it('says the gateway does not serve an unknown domain', () => {
    const w = render({ cause: new UnknownDomainError('unknown', -32001), error: 'unknown' })
    expect(w.find('[data-slot="unknown-domain"]').text()).toBe('This gateway does not serve domain 4')
    expect(w.find('p[role="alert"]').exists()).toBe(false)
  })

  it('shows "A check failed" with the error for a verification failure', () => {
    const w = render({ cause: new GatewayVerificationError('zeno_getInputs', 'input root'), error: 'zeno_getInputs: input root failed' })
    const alert = w.find('[data-slot="failed-check"]')
    expect(alert.text()).toContain('A check failed')
    expect(alert.text()).toContain('input root failed')
  })

  it('shows any other error as plain text', () => {
    const w = render({ cause: new Error('boom'), error: 'boom' })
    expect(w.find('p[role="alert"]').text()).toBe('boom')
  })
})
