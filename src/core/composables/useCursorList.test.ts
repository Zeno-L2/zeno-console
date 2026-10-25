import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Page } from 'zeno-client'
import { useCursorList } from './useCursorList'

type Row = { n: number }

const pageOf = (items: number[], nextCursor: string | null, batchId: number | null = 3): Page<Row> =>
  ({ domainId: 1, batchId, verified: true, items: items.map((n) => ({ n })), nextCursor }) as Page<Row>

/** Serves `c1` after the first page and `c2` after `c1`. */
function chain() {
  return vi.fn(async (cursor: string | null) => {
    if (cursor === null) return pageOf([1, 2], 'c1')
    if (cursor === 'c1') return pageOf([3, 4], 'c2')
    return pageOf([5], null)
  })
}

describe('useCursorList', () => {
  it('starts on page 1 with no Newer and no Older before a load', () => {
    const list = useCursorList(chain())
    expect(list.pageNumber.value).toBe(1)
    expect(list.hasNewer.value).toBe(false)
    expect(list.hasOlder.value).toBe(false)
    expect(list.items.value).toEqual([])
  })

  it('loads the first page with a null cursor and the page size', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    expect(fetchPage).toHaveBeenCalledWith(null, list.pageSize.value)
    expect(list.items.value).toEqual([{ n: 1 }, { n: 2 }])
    expect(list.hasOlder.value).toBe(true)
    expect(list.hasNewer.value).toBe(false)
  })

  it('returns to the first page after Older then Newer', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    await list.older()
    expect(fetchPage).toHaveBeenLastCalledWith('c1', list.pageSize.value)
    expect(list.pageNumber.value).toBe(2)
    expect(list.hasNewer.value).toBe(true)
    expect(list.items.value).toEqual([{ n: 3 }, { n: 4 }])
    await list.newer()
    expect(fetchPage).toHaveBeenLastCalledWith(null, list.pageSize.value)
    expect(list.pageNumber.value).toBe(1)
    expect(list.hasNewer.value).toBe(false)
    expect(list.items.value).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('walks two pages back through the cursors it kept', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    await list.older()
    await list.older()
    expect(list.pageNumber.value).toBe(3)
    expect(list.hasOlder.value).toBe(false)
    await list.newer()
    expect(fetchPage).toHaveBeenLastCalledWith('c1', list.pageSize.value)
    expect(list.pageNumber.value).toBe(2)
  })

  it('keeps Older enabled on a short page that carries a cursor', async () => {
    const list = useCursorList(async () => pageOf([1], 'more'))
    await list.reset()
    expect(list.items.value).toHaveLength(1)
    expect(list.items.value.length).toBeLessThan(list.pageSize.value)
    expect(list.hasOlder.value).toBe(true)
  })

  it('keeps Older enabled on an empty page that carries a cursor', async () => {
    const list = useCursorList(async () => pageOf([], 'more'))
    await list.reset()
    expect(list.items.value).toEqual([])
    expect(list.hasOlder.value).toBe(true)
  })

  it('disables Older when the page has no cursor', async () => {
    const list = useCursorList(async () => pageOf([1, 2, 3], null))
    await list.reset()
    expect(list.hasOlder.value).toBe(false)
  })

  it('does nothing for Older without a cursor and for Newer on the first page', async () => {
    const fetchPage = vi.fn(async () => pageOf([1], null))
    const list = useCursorList(fetchPage)
    await list.reset()
    fetchPage.mockClear()
    await list.older()
    await list.newer()
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('resets to the first page when the page size changes', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    await list.older()
    expect(list.pageNumber.value).toBe(2)
    list.pageSize.value = 50
    await nextTick()
    await vi.waitFor(() => expect(list.pageNumber.value).toBe(1))
    expect(fetchPage).toHaveBeenLastCalledWith(null, 50)
    expect(list.items.value).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('reloads the page on screen with load', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    await list.older()
    fetchPage.mockClear()
    await list.load()
    expect(fetchPage).toHaveBeenCalledWith('c1', list.pageSize.value)
    expect(list.pageNumber.value).toBe(2)
  })

  it('does not let a slow earlier response overwrite a newer one', async () => {
    let releaseSlow: (page: Page<Row>) => void = () => undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Page<Row>>((resolve) => (releaseSlow = resolve)))
      .mockImplementationOnce(async () => pageOf([9], null))
    const list = useCursorList<Row>(fetchPage)
    const slow = list.reset()
    const fast = list.reset()
    await fast
    expect(list.items.value).toEqual([{ n: 9 }])
    releaseSlow(pageOf([1, 2], 'stale'))
    await slow
    expect(list.items.value).toEqual([{ n: 9 }])
    expect(list.hasOlder.value).toBe(false)
    expect(list.isLoading.value).toBe(false)
  })

  it('ignores a slow earlier failure after a newer success', async () => {
    let failSlow: (err: Error) => void = () => undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Page<Row>>((_, reject) => (failSlow = reject)))
      .mockImplementationOnce(async () => pageOf([1], null))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const list = useCursorList<Row>(fetchPage)
    const slow = list.reset()
    await list.reset()
    failSlow(new Error('late failure'))
    await slow
    expect(list.error.value).toBeNull()
    expect(list.items.value).toEqual([{ n: 1 }])
    vi.restoreAllMocks()
  })

  it('keeps the page and the cursors when a load fails, and exposes the thrown error as cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = new Error('gateway down')
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(async () => pageOf([1, 2], 'c1'))
      .mockImplementationOnce(async () => {
        throw boom
      })
    const list = useCursorList<Row>(fetchPage)
    await list.reset()
    await list.older()
    expect(list.error.value).toBe('gateway down')
    expect(list.cause.value).toBe(boom)
    expect(list.pageNumber.value).toBe(1)
    expect(list.items.value).toEqual([{ n: 1 }, { n: 2 }])
    expect(list.isLoading.value).toBe(false)
    vi.restoreAllMocks()
  })

  it('uses the fallback message for a thrown non-Error and clears the error on the next load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw 'nope'
      })
      .mockImplementationOnce(async () => pageOf([1], null))
    const list = useCursorList<Row>(fetchPage, 'Failed to load the thing')
    await list.reset()
    expect(list.error.value).toBe('Failed to load the thing')
    await list.reset()
    expect(list.error.value).toBeNull()
    expect(list.cause.value).toBeNull()
    vi.restoreAllMocks()
  })

  it('keeps batchId null for a page no batch has reached', async () => {
    const list = useCursorList(async () => pageOf([], null, null))
    await list.reset()
    expect(list.page.value?.batchId).toBeNull()
    expect(list.items.value).toEqual([])
  })

  it('refresh reloads the newest page but waits while a read is in flight', async () => {
    let release: (page: Page<Row>) => void = () => undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(async () => pageOf([1, 2], 'c1'))
      .mockImplementationOnce(() => new Promise<Page<Row>>((resolve) => (release = resolve)))
    const list = useCursorList<Row>(fetchPage)
    await list.reset()
    const older = list.older()
    await list.refresh()
    expect(fetchPage).toHaveBeenCalledTimes(2)
    release(pageOf([3, 4], null))
    await older
    expect(list.pageNumber.value).toBe(2)
  })

  it('refresh does nothing on an older page and reloads the first page', async () => {
    const fetchPage = chain()
    const list = useCursorList(fetchPage)
    await list.reset()
    fetchPage.mockClear()
    await list.refresh()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    await list.older()
    fetchPage.mockClear()
    await list.refresh()
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('restart returns to page 1 even when the first read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(async () => pageOf([1, 2], 'c1'))
      .mockImplementationOnce(async () => pageOf([3, 4], 'c2'))
      .mockImplementationOnce(async () => {
        throw new Error('other domain down')
      })
    const list = useCursorList<Row>(fetchPage)
    await list.reset()
    await list.older()
    expect(list.pageNumber.value).toBe(2)
    await list.restart()
    expect(list.pageNumber.value).toBe(1)
    expect(list.hasNewer.value).toBe(false)
    expect(list.items.value).toEqual([])
    vi.restoreAllMocks()
  })
})
