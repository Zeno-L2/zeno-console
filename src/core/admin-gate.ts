/** The gate only hides controls. Settlement enforces the check on chain. */
export function isAdminAddress(address: string | null | undefined, admin: string): boolean {
  return Boolean(address) && admin.trim() !== '' && address === admin.trim()
}
