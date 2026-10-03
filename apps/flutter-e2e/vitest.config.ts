import { defineConfig } from 'vitest/config';

// Les tests e2e pilotent un vrai navigateur : plus lents que les tests unitaires
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 90_000 } });
