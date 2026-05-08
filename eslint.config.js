import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/.next/**',
      '**/data/**',
      '**/prisma/migrations/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // CommonJS files (`.cjs`) have to use `require` by definition.
    // Mobile (Expo / React Native) build configs are also CJS but happen to
    // use a `.js` extension, so they're matched explicitly.
    files: ['**/*.cjs', 'apps/client/mobile/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
