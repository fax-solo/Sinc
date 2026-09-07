/** Minimal react-native stub so stores that touch nativeBridge can run in Node tests. */
export class NativeEventEmitter {
  addListener() {}
  removeListener() {}
  removeAllListeners() {}
  emit() {}
}

export const NativeModules = {};

export const Platform = {
  OS: 'android',
  Version: 0,
  select: (specs: Record<string, unknown>) => specs,
};

export const LogBox = { ignoreLogs() {} };

export default {};
