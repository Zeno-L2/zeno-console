import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SendStages from './SendStages.vue'

describe('SendStages', () => {
  it('lists every stage', () => {
    const w = mount(SendStages, { props: { state: null } })
    for (const title of ['Published', 'Received', 'Executed', 'Submitted', 'Finalized']) {
      expect(w.text()).toContain(title)
    }
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows the tracker error', () => {
    const w = mount(SendStages, { props: { state: { sendHash: 'ab', stage: 'received', error: 'node unreachable' } } })
    expect(w.find('[role="alert"]').text()).toBe('node unreachable')
  })

  it('shows two steps and the L1-only note', () => {
    const w = mount(SendStages, { props: { state: { sendHash: 'ab', stage: 'received', l1Only: true } } })
    expect(w.text()).toContain('Published')
    expect(w.text()).toContain('Received')
    expect(w.text()).not.toContain('Executed')
    expect(w.find('[data-slot="l1-only"]').exists()).toBe(true)
  })

  it('shows the refusal and not the L1-only note for a refused send', () => {
    const w = mount(SendStages, { props: { state: { sendHash: 'ab', stage: 'received', l1Only: true, refused: true, error: 'Settlement refused this send. It had no effect.' } } })
    expect(w.find('[role="alert"]').text()).toContain('Settlement refused this send')
    expect(w.find('[data-slot="l1-only"]').exists()).toBe(false)
  })

  it('ends a refused input send at Received with no active step', () => {
    const w = mount(SendStages, { props: { state: { sendHash: 'ab', stage: 'received', refused: true, error: 'Settlement refused this send.' } } })
    expect(w.text()).not.toContain('Executed')
    expect(w.text()).not.toContain('Finalized')
    expect(w.find('[aria-current="step"]').exists()).toBe(false)
  })

  it('describes Received without naming the recipient', () => {
    const w = mount(SendStages, { props: { state: { sendHash: 'ab', stage: 'received' } } })
    expect(w.text()).toContain('The recipient received the send.')
    expect(w.text()).not.toContain('Settlement received')
  })
})
