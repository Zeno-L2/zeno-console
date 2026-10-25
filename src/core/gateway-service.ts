import { GatewayClient, TagUnavailableError } from 'zeno-client'
import type { Head, Tag } from 'zeno-client'
import { DEFAULT_GATEWAY_URL } from '../config'
import { SettlementService } from './settlement-service'
import { ZenonService } from './zenon-service'
import { MissingSendError, NodeReadError } from './tx-tracker-service'

/**
 * The shared connection to the gateway. Every L2 read goes through the
 * client it holds, which checks proofs against the roots Settlement
 * records. The client reads send blocks and batches from the node,
 * connects on first use, and connects again when the URL changes, the
 * node changes, or a WebSocket connection fails.
 */
export class GatewayService {
  private static instance: GatewayService | null = null
  private url = DEFAULT_GATEWAY_URL
  private pending: Promise<GatewayClient> | null = null
  /** The node URL the current client was built for. */
  private clientNode: string | null = null

  constructor(
    private readonly settlement: Pick<SettlementService, 'getBatch' | 'getAccountBlock'> = SettlementService.getInstance(),
    private readonly nodeUrl: () => string = () => ZenonService.getInstance().getNodeUrl()
  ) {}

  static getInstance(): GatewayService {
    if (!GatewayService.instance) {
      GatewayService.instance = new GatewayService()
    }
    return GatewayService.instance
  }

  getUrl(): string {
    return this.url
  }

  /** Points the service at `url`. A new URL closes the current client. */
  configure(url: string): void {
    if (url === this.url) return
    this.url = url
    this.close()
  }

  /** The connected client. Rejects when the gateway cannot be reached. */
  client(): Promise<GatewayClient> {
    // A new node needs a new client: its Settlement root cache holds the old node's entries.
    const node = this.nodeUrl()
    if (this.pending && this.clientNode !== node) this.close()
    if (!this.pending) {
      this.clientNode = node
      const connecting = GatewayClient.connect(this.url, {
        batches: async (domainId, batchId) => {
          try {
            return await this.settlement.getBatch(domainId, batchId)
          } catch (error) {
            throw new NodeReadError(error)
          }
        },
        // The same node as `batches`. A missing send throws a typed error, so the
        // receipt check waits for a lagging node instead of failing the read.
        sends: async (hash) => {
          let block
          try {
            block = await this.settlement.getAccountBlock(hash)
          } catch (error) {
            throw new NodeReadError(error)
          }
          if (!block) throw new MissingSendError()
          return block
        },
        // A WebSocket client never reopens, so drop it and connect again on the next call.
        onError: () => {
          if (this.pending === connecting) this.close()
        },
      })
      this.pending = connecting
      // A failed connect must not stick: the next call tries again.
      connecting.catch(() => {
        if (this.pending === connecting) this.pending = null
      })
    }
    return this.pending
  }

  close(): void {
    const closing = this.pending
    this.pending = null
    closing?.then((client) => client.close()).catch(() => undefined)
  }

  async getHead(domainId: number): Promise<Head> {
    return (await this.client()).getHead(domainId)
  }

  /**
   * Runs `read` at `tag`. A remote gateway does not serve `pending`, and
   * that is not a failure: the read runs again at `latest`. Returns the tag
   * that answered.
   */
  async withTagFallback<T>(tag: Tag, read: (tag: Tag) => Promise<T>): Promise<{ value: T; tag: Tag }> {
    try {
      return { value: await read(tag), tag }
    } catch (error) {
      if (tag === 'pending' && error instanceof TagUnavailableError) {
        return { value: await read('latest'), tag: 'latest' }
      }
      throw error
    }
  }
}
