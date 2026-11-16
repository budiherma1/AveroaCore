// ESLint 10 flat config, mirroring the AveroaJS app's config (airbnb-style
// conventions). The .d.ts / .ts type files are checked by `npm run typecheck`.
import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import { flatConfigs as importX, createNodeResolver } from 'eslint-plugin-import-x';

const root = import.meta.dirname;

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'template/**', // Edge templates of the generators
      'test/fixtures/**/storages/**',
    ],
  },

  js.configs.recommended,
  importX.recommended,

  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    settings: {
      'import-x/resolver-next': [createNodeResolver()],
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      // --- correctness / best practices (airbnb-base equivalents) ---
      'no-console': 'warn',
      // `args: 'none'`: Express needs all four error-handler parameters.
      // `ignoreRestSiblings`: `const { enabled: _enabled, ...rest } = x` drops a key on purpose.
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'no-shadow': 'error',
      'no-param-reassign': 'error',
      'no-return-await': 'off',
      'dot-notation': 'error',
      curly: ['error', 'multi-line'],
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      radix: 'error',

      // --- imports ---
      'import-x/no-unresolved': 'error',
      // a library: express, passport, objection, @averoa/* ... are peer dependencies
      'import-x/no-extraneous-dependencies': ['error', {
        devDependencies: true, optionalDependencies: false, peerDependencies: true,
      }],
      // @averoa/routes intentionally exports Router as both default and named export
      'import-x/no-named-as-default': 'off',
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/newline-after-import': 'error',

      // --- formatting (moved out of ESLint core into @stylistic) ---
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/max-len': ['error', {
        code: 100,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/arrow-parens': ['error', 'always'],
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/comma-spacing': 'error',
      '@stylistic/key-spacing': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/eol-last': 'error',
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
    },
  },

  // the CLI, the dev scripts and the tests print on purpose
  {
    files: ['command.js', 'scripts/**', 'test/**'],
    rules: { 'no-console': 'off' },
  },

  // the fixture apps' package.json files only mark app roots; their imports
  // resolve from this package's node_modules
  {
    files: ['test/fixtures/**'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', {
        devDependencies: true,
        optionalDependencies: false,
        peerDependencies: true,
        packageDir: root,
      }],
    },
  },
];
