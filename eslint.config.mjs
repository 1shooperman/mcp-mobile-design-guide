// Security-only lint pass. Biome (biome.json) owns style/formatting/general
// lint; this config exists solely to run eslint-plugin-security and
// eslint-plugin-no-unsanitized, which Biome doesn't implement.
import js from '@eslint/js';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.base, security.configs.recommended, noUnsanitized.configs.recommended],
    languageOptions: {
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['__tests__/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.base, security.configs.recommended, noUnsanitized.configs.recommended],
    languageOptions: {
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
);
