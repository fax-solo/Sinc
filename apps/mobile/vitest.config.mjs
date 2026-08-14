import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Vitest uses esbuild by default, which strips TypeScript's legacy decorators
 * (experimentalDecorators) without applying them. WatermelonDB models rely on
 * those decorators, so files that use `@` syntax are transformed with Babel
 * using the same preset as the app (@react-native/babel-preset).
 */
export default defineConfig({
  plugins: [
    {
      name: 'babel-legacy-decorators',
      enforce: 'pre',
      async transform(code, id) {
        const isDbModule =
          id.includes('/src/db/') && (id.endsWith('.ts') || id.endsWith('.tsx'));
        if (!isDbModule) {
          return undefined;
        }
        const babel = require('@babel/core');
        const result = await babel.transformAsync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          presets: [require.resolve('@babel/preset-typescript')],
          plugins: [
            [require.resolve('@babel/plugin-proposal-decorators'), { version: 'legacy' }],
            [require.resolve('@babel/plugin-transform-class-properties'), { loose: true }],
          ],
        });
        return result ? { code: result.code ?? '', map: result.map ?? null } : undefined;
      },
    },
  ],
});