import { Address, QSR_ZTS, TokenStandard, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountInfo, PlasmaInfo } from 'znn-typescript-sdk'
import { ChainService } from './chain-service'

export class AccountService extends ChainService {
  private static instance: AccountService | null = null

  static getInstance(): AccountService {
    if (!AccountService.instance) {
      AccountService.instance = new AccountService()
    }
    return AccountService.instance
  }

  async getAccountInfo(address: string): Promise<AccountInfo | null> {
    await this.ensureInitialized()
    return this.zenon.ledger.getAccountInfoByAddress(Address.parse(address))
  }

  /** The raw balance of `zts` (a `zts1...` string), zero for an unused account. */
  async getBalance(address: string, zts: string = ZNN_ZTS.toString()): Promise<bigint> {
    const info = await this.getAccountInfo(address)
    return info?.balanceInfoMap[zts]?.balance ?? 0n
  }

  async getPlasma(address: string): Promise<PlasmaInfo> {
    await this.ensureInitialized()
    return this.zenon.embedded.plasma.get(Address.parse(address))
  }

  /** The decimals of a token, so a typed amount converts to base units. Null for an unknown token. */
  async getTokenDecimals(zts: string): Promise<number | null> {
    if (zts === ZNN_ZTS.toString() || zts === QSR_ZTS.toString()) return 8
    await this.ensureInitialized()
    const token = await this.zenon.embedded.token.getByZts(TokenStandard.parse(zts))
    return token ? token.decimals : null
  }
}
