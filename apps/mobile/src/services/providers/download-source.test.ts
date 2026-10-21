import { describe, expect, it } from 'vitest';
import {
  hasForbiddenVariant,
  pickArchiveFile,
  scoreArchiveFile,
  validateSearchHit,
} from './download-source';

describe('pickArchiveFile', () => {
  it('accepts real Archive audio files (format "VBR MP3")', () => {
    expect(pickArchiveFile([{ name: 'show-2024-02-18.mp3', format: 'VBR MP3' }])).toEqual({
      name: 'show-2024-02-18.mp3',
    });
  });

  it('accepts Ogg Vorbis files', () => {
    expect(pickArchiveFile([{ name: 'track.ogg', format: 'Ogg Vorbis' }])).toEqual({
      name: 'track.ogg',
    });
  });

  it('rejects torrents, images and metadata', () => {
    expect(
      pickArchiveFile([
        { name: 'item_archive.torrent', format: 'Archive BitTorrent' },
        { name: 'cover.jpg', format: 'JPEG' },
        { name: 'meta.xml', format: 'Metadata' },
      ])
    ).toBeNull();
  });

  it('prefers full mp3s over previews and derived junk', () => {
    const picked = pickArchiveFile([
      { name: 'track_64kb.mp3', format: 'VBR MP3' },
      { name: 'track_spectrogram.png', format: 'PNG' },
      { name: 'track.mp3', format: 'VBR MP3' },
    ]);
    expect(picked).toEqual({ name: 'track.mp3' });
  });

  it('returns null when nothing playable exists', () => {
    expect(pickArchiveFile([])).toBeNull();
    expect(pickArchiveFile([{ name: 'notes.txt', format: 'Text' }])).toBeNull();
  });
});

describe('scoreArchiveFile', () => {
  it('ranks clean mp3s above samples', () => {
    expect(scoreArchiveFile('a.mp3')).toBeGreaterThan(scoreArchiveFile('a_64kb.mp3'));
  });
});

describe('validateSearchHit', () => {
  it('accepts a title/artist/duration match', () => {
    expect(
      validateSearchHit(
        'Daylight',
        'Ariana Grande',
        'Daylight (Album Version)',
        'ArianaGrande',
        210_000,
        210_000
      )
    ).toBe(true);
  });

  it('rejects a different song whose title merely shares tokens', () => {
    expect(
      validateSearchHit('Runaway', 'Aurora', 'Runaway Baby', 'Some Band', 95_000, 240_000)
    ).toBe(false);
  });

  it('rejects zero artist evidence even on an exact title', () => {
    expect(validateSearchHit('Daylight', 'Ariana Grande', 'Daylight', '', 210_000, 210_000)).toBe(
      false
    );
    expect(
      validateSearchHit('Daylight', 'Ariana Grande', 'Daylight', 'Cover Nation', 210_000, 210_000)
    ).toBe(false);
  });

  it('skips the artist requirement only when the request has no artist', () => {
    expect(validateSearchHit('Daylight', '', 'Daylight', 'Someone Else', 210_000, 210_000)).toBe(
      true
    );
  });

  it('rejects a tight-title hit whose duration is far off', () => {
    expect(
      validateSearchHit('Daylight', 'Ariana Grande', 'Daylight', 'Ariana Grande', 60_000, 210_000)
    ).toBe(false);
  });

  it('ignores durations that the provider does not report', () => {
    expect(
      validateSearchHit('Daylight', 'Ariana Grande', 'Daylight', 'Ariana Grande', 0, 210_000)
    ).toBe(true);
  });

  it('rejects an alteration the query never asked for (sped up / live / karaoke)', () => {
    expect(
      validateSearchHit(
        'Daylight',
        'Ariana Grande',
        'Daylight (Sped Up)',
        'Ariana Grande',
        210_000,
        210_000
      )
    ).toBe(false);
    expect(
      validateSearchHit(
        'Daylight',
        'Ariana Grande',
        'Daylight (Live in London)',
        'Ariana Grande',
        260_000,
        210_000
      )
    ).toBe(false);
    expect(
      validateSearchHit(
        'Daylight',
        'Ariana Grande',
        'Daylight Karaoke',
        'Sing It',
        210_000,
        210_000
      )
    ).toBe(false);
  });

  it('keeps accepting the canonical original even when words merely contain a tag', () => {
    // "Stayin' Alive" embeds "live" — boundary-safe matching must not treat it
    // as a live recording.
    expect(
      validateSearchHit("Stayin' Alive", 'Bee Gees', "Stayin' Alive", 'Bee Gees', 285_000, 285_000)
    ).toBe(true);
  });

  it('accepts requested variants verbatim', () => {
    expect(
      validateSearchHit(
        'Daylight (Live)',
        'Ariana Grande',
        'Daylight (Live)',
        'Ariana Grande',
        260_000,
        260_000
      )
    ).toBe(true);
  });

  it('matches a collab request by any credited artist', () => {
    expect(validateSearchHit('Water', 'Tyla & Gunna', 'Water', 'Tyla', 200_000, 200_000)).toBe(
      true
    );
    expect(
      validateSearchHit('Water', 'Tyla, Gunna & Skillibeng', 'Water', 'Gunna', 200_000, 200_000)
    ).toBe(true);
    expect(
      validateSearchHit('Water', 'Tyla & Gunna', 'Water', 'Trending Mozambique', 200_000, 200_000)
    ).toBe(false);
  });
});

describe('hasForbiddenVariant', () => {
  it('derivative spellings of forbidden tags still match', () => {
    expect(hasForbiddenVariant('Golden Hour', 'Golden Hour (Instrumentals)')).toBe(true);
    expect(hasForbiddenVariant('Rehab', 'Rehab 1 Hour Loop Version')).toBe(true);
    expect(hasForbiddenVariant("Stayin' Alive", "Stayin' Alive")).toBe(false);
    expect(hasForbiddenVariant('Golden Hour', 'Golden Hour (Album Version)')).toBe(false);
  });
});
