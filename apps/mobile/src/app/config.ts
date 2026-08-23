/**
 * App-wide configuration.
 *
 * On a physical device the backend is reachable through an adb reverse tunnel
 * (`adb reverse tcp:3000 tcp:3000`), so localhost maps to the host machine.
 */
export const config = {
  apiBaseUrl: 'http://127.0.0.1:3000',
} as const;
