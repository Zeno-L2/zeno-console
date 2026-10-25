import type { Router } from 'vue-router'
import { NotFoundError, TagUnavailableError, UnknownDomainError, UnsupportedProfileError } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { useDomains } from './useDomains'

const ADDRESS_PATTERN = /^z1[0-9a-z]{38}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const NUMBER_PATTERN = /^\d+$/

/** found: routed. none: every probe answered no match. retry: no match, and a probe answered TagUnavailableError. */
export type SearchOutcome = 'found' | 'none' | 'retry'

type Probe = 'match' | 'miss' | 'busy'

/**
 * Runs one probe. A match is true, an answer of no match is false. Every other
 * error is rethrown, so a dropped connection is not read as no match.
 */
async function probe(lookup: () => Promise<boolean>, alsoMiss: (err: unknown) => boolean = () => false): Promise<Probe> {
  try {
    return (await lookup()) ? 'match' : 'miss'
  } catch (err) {
    if (err instanceof NotFoundError || alsoMiss(err)) return 'miss'
    if (err instanceof TagUnavailableError) return 'busy'
    throw err
  }
}

/** Classifies a query and routes to it. */
export function useSearch() {
  const { defaultDomainId } = useDomains()

  async function navigate(router: Router, rawQuery: string): Promise<SearchOutcome> {
    const query = rawQuery.trim()
    if (ADDRESS_PATTERN.test(query)) {
      await router.push(`/address/${query}`)
      return 'found'
    }
    if (NUMBER_PATTERN.test(query)) {
      await router.push(`/batches/${defaultDomainId.value}/${query}`)
      return 'found'
    }
    const id = query.toLowerCase()
    if (!HASH_PATTERN.test(id)) return 'none'

    const gateway = GatewayService.getInstance()
    const domainId = defaultDomainId.value
    // A 64-hex query may be a send hash, a contract id or an outbox id, tried in that order.
    const targets: [() => Promise<boolean>, string, ((err: unknown) => boolean)?][] = [
      [async () => !!(await (await gateway.client()).getReceipt(id)), `/tx/${id}`],
      [
        async () => (await (await (await gateway.client()).contracts(domainId)).contract(id)).result.codeHash != null,
        `/contracts/${domainId}/${id}`,
        // A domain without the contracts profile, or one the gateway does not serve, has no contracts.
        (err) => err instanceof UnsupportedProfileError || err instanceof UnknownDomainError,
      ],
      [async () => !!(await (await gateway.client()).getOutboxProof(id)), `/outbox/${id}`],
    ]

    let busy = false
    for (const [lookup, path, alsoMiss] of targets) {
      const result = await probe(lookup, alsoMiss)
      if (result === 'match') {
        await router.push(path)
        return 'found'
      }
      if (result === 'busy') busy = true
    }
    return busy ? 'retry' : 'none'
  }

  return { navigate }
}
