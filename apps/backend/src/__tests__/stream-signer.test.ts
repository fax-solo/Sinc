import { describe, expect, it } from 'vitest';
import { StreamSigner } from '../domain/playback/stream-signer.js';

const signer = new StreamSigner('test-secret-0123456789abcdef', 3_600);

describe('StreamSigner', () => {
  it('round-trips: a fresh signature verifies', () => {
    const signed = signer.sign('https://cdn.example/track.mp3');
    expect(signer.verify(signed.url, signed.expiresAt, signed.signature)).toBe(true);
  });

  it('rejects an expired signature', () => {
    const signed = signer.sign('https://cdn.example/track.mp3', Date.now() - 3_700_000);
    expect(signer.verify(signed.url, signed.expiresAt, signed.signature)).toBe(false);
  });

  it('rejects a signature used for a different URL', () => {
    const signed = signer.sign('https://cdn.example/track.mp3');
    expect(signer.verify('https://cdn.example/other.mp3', signed.expiresAt, signed.signature)).toBe(
      false,
    );
  });

  it('rejects a tampered signature', () => {
    const signed = signer.sign('https://cdn.example/track.mp3');
    const tampered = `${signed.signature.slice(0, -1)}0`;
    expect(signer.verify(signed.url, signed.expiresAt, tampered)).toBe(false);
  });

  it('rejects a signature from a different secret', () => {
    const signed = signer.sign('https://cdn.example/track.mp3');
    const other = new StreamSigner('another-secret-0123456789');
    expect(other.verify(signed.url, signed.expiresAt, signed.signature)).toBe(false);
  });

  it('rejects a tampered expiry timestamp', () => {
    const signed = signer.sign('https://cdn.example/track.mp3');
    expect(signer.verify(signed.url, signed.expiresAt + 1, signed.signature)).toBe(false);
  });

  it('honors the configured TTL', () => {
    const short = new StreamSigner('short-lived', 60);
    const signed = short.sign('https://cdn.example/track.mp3', 1_000_000);
    expect(signed.expiresAt - 1_000_000).toBe(60_000);
    expect(short.verify(signed.url, signed.expiresAt, signed.signature, 1_000_000)).toBe(true);
    expect(short.verify(signed.url, signed.expiresAt, signed.signature, 1_000_000 + 60_001)).toBe(
      false,
    );
  });
});
