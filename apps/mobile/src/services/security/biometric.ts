/**
 * Biometric unlock (M7.3). Uses react-native-keychain so the "unlock token"
 * lives in the OS keystore behind biometric access control — the strongest
 * local credential Android/iOS offer. Every call is guarded: on devices where
 * the native module is missing or biometrics are unavailable these helpers
 * fail soft so the PIN path still works.
 */
import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.sinc.app.biometric-lock';

/** True when the device has an enrolled biometric and keychain is available. */
export async function biometricSupported(): Promise<boolean> {
  try {
    const type = await Keychain.getSupportedBiometryType();
    return type !== null;
  } catch {
    return false;
  }
}

/**
 * Stores the unlock token behind biometric access control. Resolves to true
 * when the user authenticates successfully with their fingerprint/face.
 */
export async function saveBiometricSecret(): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('sinc-lock', 'granted', {
      service: SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    });
    return result !== false;
  } catch {
    return false;
  }
}

/** Prompts for the biometric and resolves to true on success. */
export async function verifyBiometric(): Promise<boolean> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    return credentials !== false && credentials.password === 'granted';
  } catch {
    return false;
  }
}

/** Removes the biometric token (e.g. when the lock is disabled). */
export async function clearBiometricSecret(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // Already gone — fine.
  }
}
