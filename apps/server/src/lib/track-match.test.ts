import { describe, expect, it } from 'vitest';
import {
  baseTitle,
  compactText,
  normalizeText,
  pickBestMatch,
  searchTitle,
  stripVariantTags,
} from './track-match.js';

describe('normalizeText', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeText('Ariana Grande - Bloodline!')).toBe('ariana grande bloodline');
  });

  it('removes diacritics', () => {
    expect(normalizeText('Café')).toBe('cafe');
  });

  it('keeps Arabic script', () => {
    expect(normalizeText('بلو بيرى')).toContain('بلو بيرى');
  });
});

describe('stripVariantTags', () => {
  it('removes parenthetical variant tags', () => {
    expect(stripVariantTags('Bloodline (Official Audio)')).toBe('bloodline');
    expect(stripVariantTags('Bloodline (Lyrics)')).toBe('bloodline');
  });

  it('keeps the base title', () => {
    expect(stripVariantTags('WADINI - Afroto')).toBe('wadini afroto');
  });
});

describe('searchTitle', () => {
  it('drops alternative-title parentheses for search', () => {
    expect(searchTitle('بلو بيري (قولي ازاى تقدري تنسي)')).toBe('بلو بيري');
  });

  it('keeps variant tags in the search title', () => {
    expect(searchTitle('Bloodline (Remix)')).toBe('Bloodline (Remix)');
    expect(searchTitle('Calm (feat. Someone)')).toBe('Calm');
  });

  it('keeps multi-word variant phrases like "sped up" in the search title', () => {
    expect(searchTitle('Blinding Lights (sped up)')).toBe('Blinding Lights (sped up)');
    expect(searchTitle('Blinding Lights (slowed + reverb)')).toBe(
      'Blinding Lights (slowed + reverb)'
    );
  });
});

describe('compactText', () => {
  it('ignores punctuation and case', () => {
    expect(compactText('OT-SHA')).toBe('otsha');
    expect(compactText('ot sha')).toBe('otsha');
  });
});

describe('baseTitle', () => {
  it('strips all parentheticals and variant words', () => {
    expect(baseTitle('OTSHA - BLUE BERRY | اوتشا - بلو بيري ( كان فيا شئ جميل وضاع )')).toContain(
      'بلو بيري'
    );
    expect(baseTitle('Ariana Grande - bloodline (Audio)')).toBe('ariana grande bloodline');
  });
});

describe('pickBestMatch', () => {
  const candidates = [
    {
      title: 'Ariana Grande - bloodline (Audio)',
      artist: 'Ariana Grande',
      durationMs: 218_000,
      ref: 'a',
    },
    {
      title: 'Ariana Grande - Bloodline (Lyrics)',
      artist: 'Ariana Grande',
      durationMs: 204_000,
      ref: 'b',
    },
    {
      title: 'Ariana Grande - Bloodline (Official Music Video)',
      artist: 'Ariana Grande',
      durationMs: 291_000,
      ref: 'c',
    },
    {
      title: 'Ariana Grande, Ginuwine - Bloodline X Pony (TikTok Mashup) [Lyrics]',
      artist: 'Blissful Mind',
      durationMs: 223_000,
      ref: 'd',
    },
    {
      title: 'TWICE MOMO, CHAEYOUNG, TZUYU X Kiel Tutin "bloodline (Ariana Grande)" Dance Video',
      artist: 'TWICE',
      durationMs: 67_000,
      ref: 'e',
    },
  ];

  it('prefers the official upload over remix/lyrics/mashup variants', () => {
    const best = pickBestMatch(
      { title: 'bloodline', artist: 'Ariana Grande', durationMs: 216_000 },
      candidates
    );
    expect(best?.candidate.ref).toBe('a');
  });

  it('accepts a variant when the query explicitly asks for it', () => {
    const best = pickBestMatch(
      { title: 'bloodline (remix)', artist: 'Ariana Grande', durationMs: 223_000 },
      [
        { title: 'Bloodline (Remix)', artist: 'Ariana Grande', durationMs: 223_000, ref: 'r' },
        { title: 'bloodline', artist: 'Ariana Grande', durationMs: 218_000, ref: 'o' },
      ]
    );
    expect(best?.candidate.ref).toBe('r');
  });

  it('prefers the requested sped-up variant over the official upload', () => {
    const best = pickBestMatch(
      { title: 'Blinding Lights (sped up)', artist: 'The Weeknd', durationMs: 161_000 },
      [
        {
          title: 'Blinding Lights (Official Video)',
          artist: 'The Weeknd',
          durationMs: 203_000,
          ref: 'official',
        },
        {
          title: 'The Weeknd - Blinding Lights (Sped Up)',
          artist: 'Fan Uploader',
          durationMs: 154_000,
          ref: 'spedup',
        },
      ]
    );
    expect(best?.candidate.ref).toBe('spedup');
    expect(best!.score).toBeGreaterThan(45);
  });

  it('prefers the requested slowed variant over the original', () => {
    const best = pickBestMatch(
      { title: 'Another Love (slowed + reverb)', artist: 'Tom Odell', durationMs: 261_000 },
      [
        { title: 'Another Love', artist: 'Tom Odell', durationMs: 244_000, ref: 'original' },
        {
          title: 'Another Love (slowed + reverb)',
          artist: 'Nightcore Edits',
          durationMs: 259_000,
          ref: 'slowed',
        },
      ]
    );
    expect(best?.candidate.ref).toBe('slowed');
  });

  it('ignores the variant priority when the query asks for nothing', () => {
    const best = pickBestMatch(
      { title: 'Blinding Lights', artist: 'The Weeknd', durationMs: 203_000 },
      [
        {
          title: 'Blinding Lights (Official Video)',
          artist: 'The Weeknd',
          durationMs: 203_000,
          ref: 'official',
        },
        {
          title: 'The Weeknd - Blinding Lights (Sped Up)',
          artist: 'Fan Uploader',
          durationMs: 154_000,
          ref: 'spedup',
        },
      ]
    );
    expect(best?.candidate.ref).toBe('official');
  });

  it('penalizes a different artist reusing the title', () => {
    const best = pickBestMatch(
      { title: 'bloodline', artist: 'Ariana Grande', durationMs: 216_000 },
      [{ title: 'Bloodline', artist: 'Some Other Artist', durationMs: 216_000, ref: 'x' }]
    );
    expect(best?.candidate.ref).toBe('x');
    expect(best!.score).toBeLessThan(100);
  });

  it('uses duration proximity to break title ties', () => {
    const best = pickBestMatch({ title: 'Blueberry', artist: 'otsha', durationMs: 178_000 }, [
      { title: 'Blueberry', artist: 'otsha', durationMs: 140_000, ref: 'short' },
      { title: 'Blueberry', artist: 'otsha', durationMs: 178_000, ref: 'exact' },
      { title: 'Blueberry', artist: 'otsha', durationMs: 340_000, ref: 'long' },
    ]);
    expect(best?.candidate.ref).toBe('exact');
  });

  it('rejects a mashup whose title uses styled Unicode letters', () => {
    const best = pickBestMatch(
      { title: 'bloodline', artist: 'Ariana Grande', durationMs: 216_000 },
      [
        {
          title: '𝖺𝗋𝗂𝖺𝗇𝖺 𝗀𝗋𝖺𝗇𝖽𝖾 + 𝗀𝗂𝗇𝗎𝗐𝗂𝗇𝖾: 𝖻𝗅𝗈𝗈𝖽𝗅𝗂𝗇𝖾 𝗑 𝗉𝗈𝗇𝗒',
          artist: 'kenzie ☆ izukusqt',
          durationMs: 222_691,
          ref: 'mashup',
        },
      ]
    );
    expect(best).toBeNull();
  });

  it('accepts an Arabic upload whose alternative-title parenthetical differs', () => {
    const best = pickBestMatch(
      { title: 'بلو بيري (قولي ازاى تقدري تنسي)', artist: 'otsha', durationMs: 178_000 },
      [
        {
          title: 'OTSHA - BLUE BERRY | اوتشا - بلو بيري ( كان فيا شئ جميل وضاع )',
          artist: 'OT$HA',
          durationMs: 180_000,
          ref: 'video',
        },
      ]
    );
    expect(best?.candidate.ref).toBe('video');
    expect(best!.score).toBeGreaterThanOrEqual(45);
  });

  it('returns null for an empty candidate list', () => {
    expect(pickBestMatch({ title: 'x', artist: 'y', durationMs: 1 }, [])).toBeNull();
  });

  it('rejects candidates below the acceptance threshold', () => {
    const best = pickBestMatch({ title: 'blueberry', artist: 'otsha', durationMs: 178_000 }, [
      { title: 'Unrelated Top 40 Hit', artist: 'Someone Else', durationMs: 200_000, ref: 'nope' },
    ]);
    expect(best).toBeNull();
  });
});
