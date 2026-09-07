import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      /**
       * react-native ships Flow syntax (`import typeof`) that Rollup cannot
       * parse under Node. Point stores that import nativeBridge at a stub so
       * library/digest tests still run unit-style.
       */
      'react-native': fileURLToPath(
        new URL('./src/test/stubs/react-native.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
