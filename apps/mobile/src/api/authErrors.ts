import { useTranslation } from 'react-i18next';
import { ErrorCodes, isSincError } from '@sinc/shared';

/**
 * Map a thrown value to a user-facing auth error message.
 * Fallback: return the raw message (server-provided) for unknown codes.
 */
export function useAuthError(): (err: unknown) => string {
  const { t } = useTranslation();
  return (err) => {
    if (!isSincError(err)) return t('common.error');
    switch (err.code) {
      case ErrorCodes.EMAIL_NOT_VERIFIED:
        return t('auth.emailNotVerified');
      case ErrorCodes.ACCOUNT_SUSPENDED:
        return t('auth.accountSuspended');
      case ErrorCodes.INVALID_CREDENTIALS:
      case ErrorCodes.UNAUTHORIZED:
        return t('auth.invalidCredentials');
      case ErrorCodes.VALIDATION_ERROR:
        return t('auth.validationError');
      case ErrorCodes.RATE_LIMITED:
        return t('auth.tooManyRequests');
      case ErrorCodes.OFFLINE:
        return t('auth.networkError');
      default:
        return err.message || t('common.error');
    }
  };
}
