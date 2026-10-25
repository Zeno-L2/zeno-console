import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import type { VerificationInput } from '../core/verification'
import VerificationBadge from './VerificationBadge.vue'

const render = (props: VerificationInput) =>
  mount({ render: () => h(TooltipProvider, null, () => h(VerificationBadge, props)) })

describe('VerificationBadge', () => {
  it('shows Verified for a verified result', () => {
    const w = render({ verified: true })
    expect(w.text()).toBe('Verified')
    expect(w.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
  })

  it('shows Pending for a result built by the executor', () => {
    const w = render({ verified: false })
    expect(w.text()).toBe('Pending')
    expect(w.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('pending')
  })

  it('shows Inconsistent when the domain is inconsistent', () => {
    const w = render({ verified: true, domainStatus: 'INCONSISTENT' })
    expect(w.text()).toBe('Inconsistent')
  })

  it('shows Inconsistent when a check failed', () => {
    const w = render({ verified: false, failed: true })
    expect(w.text()).toBe('Inconsistent')
    expect(w.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('inconsistent')
  })
})
