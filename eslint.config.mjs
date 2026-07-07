// eslint.config.mjs — flat config. Regras recommended SEM type-checking
// (rápido; as type-aware ficam para depois). Prettier trata do estilo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'site/',
      'site-dist/',
      'logs/',
      'node_modules/',
      'tools/clone-venv/',
      'audio-cache/',
      'voice-clones/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
