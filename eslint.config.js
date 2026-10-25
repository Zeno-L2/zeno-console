import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

const RUNTIME_KIND = {
  selector:
    "MemberExpression[computed=false][property.name='runtimeKind'], MemberExpression[computed=true][property.value='runtimeKind']",
  message: 'Pages must not branch on or display runtimeKind outside DomainOverview.',
}

// ESLint 9 flat config. Uses the Vue + typescript-eslint flat presets.
export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'vue/no-v-html': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // A test asserts what it set up, and a wrong non-null assertion fails the test at once.
  {
    name: 'app/tests',
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // The app shows what every runtime has in common. DomainOverview renders the runtime
  // label, DomainCard shows it on the domain list, the RegisterDomain admin form must set a
  // runtime kind, and tests may set a runtime in a fixture.
  {
    name: 'app/no-runtime-kind',
    files: ['src/**/*.{ts,vue}'],
    ignores: [
      'src/pages/DomainOverview.vue',
      'src/core/admin-actions.ts',
      'src/components/DomainCard.vue',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', RUNTIME_KIND],
      'vue/no-restricted-syntax': ['error', RUNTIME_KIND],
    },
  },

  // The wallet adapter is a separate chunk that downloads when the user connects.
  // loadWallet() is the only importer; type imports stay allowed.
  {
    name: 'app/lazy-wallet',
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/core/wallet-loader.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/wallet-provider-service'],
              allowTypeImports: true,
              message:
                'Load the wallet adapter through loadWallet(), so it downloads only when the user connects.',
            },
          ],
        },
      ],
    },
  }
)
