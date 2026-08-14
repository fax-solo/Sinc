/**
 * Dependency-free ULID generation (Crockford base32, time-sortable, 26 chars).
 * ULIDs are the canonical app-wide identifier scheme: lexicographically sortable
 * and safe to use as primary keys in distributed systems.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  if (Number.isNaN(now) || now < 0) throw new Error('Invalid time value for ULID');
  let mod: number;
  let str = '';
  do {
    mod = now % ENCODING_LEN;
    str = CROCKFORD[mod]! + str;
    now = Math.floor(now / ENCODING_LEN);
  } while (now > 0 && str.length < len);
  if (str.length < len) {
    str = CROCKFORD[0]!.repeat(len - str.length) + str;
  }
  return str;
}

function encodeRandom(len: number): string {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += CROCKFORD[Math.floor(Math.random() * ENCODING_LEN)]!;
  }
  return str;
}

/** Generate a ULID from a timestamp (defaults to now). */
export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime, TIME_LEN) + encodeRandom(RANDOM_LEN);
}

/** Extract the embedded timestamp from a ULID (ms since epoch). */
export function ulidTime(id: string): number {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    throw new Error(`Invalid ULID: ${id}`);
  }
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    time = time * ENCODING_LEN + CROCKFORD.indexOf(id[i]!);
  }
  return time;
}

/** Is the string a syntactically valid ULID? */
export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
