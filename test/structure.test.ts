import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function grep(args: string[]): string {
  try {
    return execFileSync('git', ['grep', '-n', ...args], { cwd: root, encoding: 'utf8' })
  } catch (err) {
    // git grep exits with status 1 when nothing matches.
    if ((err as { status?: number }).status === 1) return ''
    throw err
  }
}

describe('repository layout', () => {
  it('has no apps or packages folder and no workspaces', () => {
    expect(existsSync(resolve(root, 'apps'))).toBe(false)
    expect(existsSync(resolve(root, 'packages'))).toBe(false)
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.workspaces).toBeUndefined()
  })

  it('has no reference to the removed shared package or workspace folders in the source, configs and AGENTS.md', () => {
    // The terms are built from parts so that this file does not contain them.
    const found = grep([
      '-e', 'zeno-' + 'shared', '-e', 'packages' + '/', '-e', 'apps' + '/',
      '--', 'src', 'test', '*.ts', '*.js', '*.json', 'AGENTS.md',
      ':!package-lock.json',
    ])
    expect(found).toBe('')
  })

  it('has no source file that declares the nom-ui mobile nav class itself', () => {
    expect(grep(['sm:hidden', '--', 'src'])).toBe('')
  })

  it('has no second contract page, console state tab or link to one', () => {
    const removed = ['pages/Contract' + 'Workbench.vue', 'components/State' + 'Tab.vue', 'core/composables/useContract' + 'State.ts']
    for (const file of removed) expect(existsSync(resolve(root, 'src', file)), file).toBe(false)
    // The terms are built from parts so that this file does not contain them.
    expect(grep(['-e', 'Call and ' + 'manage', '-e', 'Contract' + 'Workbench', '--', 'src', 'test'])).toBe('')
  })

  it('points every @source in the stylesheet at a folder that exists', () => {
    const css = readFileSync(resolve(root, 'src/style.css'), 'utf8')
    const sources = [...css.matchAll(/@source\s+'([^']+)'/g)].map((m) => m[1])
    expect(sources).toContain('../node_modules/nom-ui/src')
    for (const source of sources) {
      expect(existsSync(resolve(root, 'src', source)), source).toBe(true)
    }
  })

  it('finds the nom-ui mobile nav class in the file the stylesheet scans', () => {
    const file = resolve(root, 'node_modules/nom-ui/src/components/mobile-nav/MobileNav.vue')
    expect(readFileSync(file, 'utf8')).toContain('sm:hidden')
  })

  it('imports the wallet adapter only in the wallet loader, apart from types and tests', () => {
    const found = grep(['-n', '-E', "wallet-provider-service'", '--', 'src', ':!*.test.ts'])
      .split('\n')
      .filter((line) => line && !line.includes('import type') && !line.startsWith('src/core/wallet-loader.ts'))
    expect(found).toEqual([])
  })

  it('fails lint for a page that imports the wallet adapter', () => {
    const source = "import { WalletProviderService } from '@/core/wallet-provider-service'\nexport const x = WalletProviderService\n"
    let output = ''
    try {
      execFileSync('npx', ['eslint', '--stdin', '--stdin-filename', 'src/pages/Probe.ts'], {
        cwd: root,
        encoding: 'utf8',
        input: source,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      output = String((err as { stdout?: string }).stdout)
    }
    expect(output).toContain('Load the wallet adapter through loadWallet()')
  }, 60000)
})
