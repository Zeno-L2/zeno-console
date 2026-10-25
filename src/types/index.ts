// Generic storage adapter interface
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

// Generic page result shape used by list composables
export interface PageResult<T> {
  list: T[]
  count: number
}

// A pending time-locked change on an embedded contract. The node reports these
// with capitalised keys that the SDK model cannot read, so they are mapped here.
export interface TimeChallenge {
  methodName: string
  paramsHash: string
  challengeStartHeight: number
}
