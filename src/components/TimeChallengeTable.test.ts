import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TimeChallengeTable from './TimeChallengeTable.vue'

describe('TimeChallengeTable', () => {
  it('lets the method and countdown cells wrap long values', () => {
    const challenges = [{ methodName: 'SetPeripheryConfig'.repeat(8), paramsHash: 'ab', challengeStartHeight: 1, dueHeight: 50 }]
    const w = mount(TimeChallengeTable, { props: { challenges: challenges as never, frontierHeight: 10 } })
    const cells = w.findAll('tbody td')
    for (const cell of [cells[0], cells[3]]) {
      expect(cell.classes()).toContain('whitespace-normal')
      expect(cell.classes()).not.toContain('whitespace-nowrap')
    }
  })
})
