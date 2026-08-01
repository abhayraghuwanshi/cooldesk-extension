import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output — linting these drowns real findings in thousands of
  // errors from bundled/minified and Tauri-codegen'd JS.
  globalIgnores([
    'dist',
    'dist-tauri',
    'release',
    'src-tauri/target',
    'src-tauri/gen',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],

      // Each face in src/faces/ and each feature in src/features/ owns a
      // private `parts/` folder. A face/feature may import its own parts
      // ('./parts/X'); reaching into someone else's parts is how the old
      // components/cooldesk/ junk drawer formed. Import the owner's entry
      // component instead, or promote the shared piece up to its root.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../*/parts/*', '../../**/parts/*', '**/faces/*/parts/*'],
            message:
              "Don't import another face's parts/ — those are private to that face. " +
              'Import the face entry, or promote the shared piece out of parts/.',
          },
        ],
      }],
    },
  },
])
