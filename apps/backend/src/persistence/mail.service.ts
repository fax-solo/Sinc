/* eslint-disable no-console -- dev mail sink logs to stdout */
import type { MailService } from '../domain/auth/types.js';

/**
 * Development mail service: logs emails to the console. Production would
 * send through an SMTP/transactional provider (e.g. configured via env).
 */
export class ConsoleMailService implements MailService {
  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    console.log(`[mail:verify] to=${to} url=${verificationUrl}`);
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    console.log(`[mail:reset] to=${to} url=${resetUrl}`);
  }

  async sendSecurityAlert(to: string, message: string): Promise<void> {
    console.log(`[mail:security] to=${to} message=${message}`);
  }
}
