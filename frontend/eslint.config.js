import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

/**
 * Flat config.
 *
 * The rule sets that earn their place here are react-hooks and jsx-a11y: the
 * first catches stale-closure and dependency bugs that are invisible in
 * review, and the second catches accessibility regressions that otherwise only
 * surface when someone tries to use the app with a keyboard or screen reader.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // Without this, core's no-unused-vars cannot see that a component
      // imported for JSX is actually used.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-key': 'error',
      'react/no-unstable-nested-components': 'error',

      // An unused variable is usually a half-finished edit, but an unused
      // function argument is often a deliberate signature match.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // These two are the whole reason the hooks plugin is here: a missing
      // dependency is a real bug, not a style preference.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',

      // Off deliberately. This rule targets cascading re-renders, but it also
      // fires on the standard "start a fetch on mount and flag it as loading"
      // pattern, which is exactly what the data-loading effects here do and is
      // what React's own data-fetching guidance shows. Leaving it on would
      // mean suppressing it at every call site, which is worse.
      'react-hooks/set-state-in-effect': 'off',

      // The event-type cards use a visually hidden radio with a styled
      // sibling, which is a legitimate pattern the stricter form of this rule
      // cannot see through.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either' }],

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Config and test files run under Node, not the browser.
  {
    files: ['*.config.js', 'tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
]
