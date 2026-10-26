// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Shared flat config for packages/shared and apps/worker.
// apps/web has its own `next lint` (eslint-config-next), so it is ignored here.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', 'apps/web/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
