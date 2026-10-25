const CONTRACT = 'f3c4c88ab4e95744fba132e39405151c44341d971d5421d466a3b43c85c94a8e'
const SEND_HASH = '04ee000000000000000000000000000000000000000000000000000000000000'
const DA_HASH = '0d7757801dd818f86159d336c7111e0329e734fa51a4b37b7c23d50345ae6cb6'
const OUTBOX_ID = 'd8b8869b123f24879b00f819cc2a580fbca7414580a1205a013002cbc77a46a2'
const STATE_PATH = 'bf389e8651179479d62be1cbcc85167f8a881aa343e39ec51d6c2bf5bca729cb'
const SENDER = 'z16yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqvrvjf7'

/** The request methods the gateway serves, with example params. Subscriptions are left out. */
export const PLAYGROUND_METHODS: { method: string; params: unknown[] }[] = [
  { method: 'zeno_chainInfo', params: [1] },
  { method: 'zeno_getHead', params: [1] },
  { method: 'zeno_getBatch', params: [1] },
  { method: 'zeno_getReceipt', params: [SEND_HASH] },
  { method: 'zeno_getStateAt', params: [1, STATE_PATH] },
  { method: 'zeno_getProof', params: [1, [STATE_PATH]] },
  { method: 'zeno_getInputs', params: [{ domainId: 1, contractId: CONTRACT }] },
  { method: 'zeno_getEvents', params: [{ domainId: 1 }] },
  { method: 'zeno_getOutbox', params: [{ domainId: 1 }] },
  { method: 'zeno_getBundle', params: [DA_HASH] },
  { method: 'zeno_getReceiptSidecar', params: [DA_HASH] },
  { method: 'zeno_getOutboxProof', params: [OUTBOX_ID] },
  { method: 'zeno_read', params: [1, 'contract', { contractId: CONTRACT }] },
  {
    method: 'zeno_simulate',
    params: [1, { kind: 'CallL2', sender: SENDER, targetContract: CONTRACT, payload: '', plasmaLimit: 1000000 }],
  },
]
