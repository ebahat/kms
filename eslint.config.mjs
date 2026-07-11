import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noRawMongooseAccess from './eslint-rules/no-raw-mongoose-access.js';

const dataLib = 'libs/data/**';
const systemScopeAllowed = ['apps/*/src/platform-admin/**', 'apps/worker/src/jobs/**'];

const mongooseRestriction = {
  paths: [{ name: 'mongoose', message: 'Import mongoose only inside libs/data (ADR-0001).' }],
  patterns: [
    {
      group: ['@nestjs/mongoose'],
      importNames: ['InjectModel'],
      message: 'InjectModel is restricted to libs/data repositories (ADR-0001).',
    },
  ],
};

const systemScopeRestriction = {
  name: '@kms/data',
  importNames: ['SystemScope'],
  message: 'SystemScope is import-restricted to platform-admin/** and jobs/** modules (ADR-0001).',
};

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/node_modules/**', 'infra/**', '**/next-env.d.ts'],
  },
  {
    plugins: {
      kms: { rules: { 'no-raw-mongoose-access': noRawMongooseAccess } },
    },
  },
  // General case: everywhere except libs/data and the SystemScope-allowed modules —
  // both the mongoose ban and the SystemScope ban apply together (ADR-0001).
  // NOTE: this block and the one below must never match the same file — flat config
  // replaces a rule's options wholesale per matching file, it does not merge arrays
  // across config objects, so an overlap here would silently drop one restriction.
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: [dataLib, ...systemScopeAllowed],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...mongooseRestriction.paths, systemScopeRestriction],
          patterns: mongooseRestriction.patterns,
        },
      ],
      'kms/no-raw-mongoose-access': 'error',
    },
  },
  // platform-admin/** and jobs/**: mongoose ban still applies; SystemScope import is allowed.
  {
    files: systemScopeAllowed,
    ignores: [dataLib],
    rules: {
      'no-restricted-imports': ['error', mongooseRestriction],
      'kms/no-raw-mongoose-access': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
