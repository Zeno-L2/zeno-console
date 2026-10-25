import type { Zenon } from 'znn-typescript-sdk'
import { ZenonService } from './zenon-service'

// Base for services that talk to the chain through a single shared ZenonService.
// ZenonService is injected (defaulted to the prod singleton) so subclasses are
// constructable with a fake in tests. Each subclass keeps its own
// `static instance` and `getInstance()`: the base intentionally does NOT own the
// singleton machinery.
export interface IZenonService {
  getZenon(): Zenon
  ensureInitialized(): Promise<void>
}

export abstract class ChainService {
  protected zenon: Zenon

  constructor(protected zenonService: IZenonService = ZenonService.getInstance()) {
    this.zenon = zenonService.getZenon()
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
  }
}
