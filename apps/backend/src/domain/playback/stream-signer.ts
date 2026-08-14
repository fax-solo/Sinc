import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedStream {
  /** The provider's media URL (what the signed redirect will point at). */
  url: string;
  /** Unix ms after which the signature is invalid. */
  expiresAt: number;
  /** Hex HMAC-SHA256 of `${url}|${expiresAt}`. */
  signature: string;
}

/**
 * Signs stream URLs so media requests can be validated without credentials:
 * the player gets a short-lived, URL-bound token; /playback/stream checks the
 * token and 302-redirects to the provider. A signature is useless once
 * expired, and never reusable for a different URL.
 */
export class StreamSigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number = 3_600,
  ) {}

  sign(url: string, nowMs = Date.now()): SignedStream {
    const expiresAt = nowMs + this.ttlSeconds * 1000;
    return {
      url,
      expiresAt,
      signature: this.digest(url, expiresAt),
    };
  }

  verify(url: string, expiresAt: number, signature: string, nowMs = Date.now()): boolean {
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
    if (typeof signature !== 'string' || signature.length === 0) return false;
    const expected = Buffer.from(this.digest(url, expiresAt), 'hex');
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  }

  private digest(url: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${url}|${expiresAt}`).digest('hex');
  }
}

/** Ephemeral secret for dev/demo boots; production sets STREAM_SIGNING_SECRET. */
export function ephemeralSecret(): string {
  return createHmac('sha256', `sinc-dev-${process.pid}-${Date.now()}`)
    .update('stream-signing')
    .digest('hex');
}
