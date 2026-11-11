import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import {
  hasForbiddenVariant,
  parseArchiveLength,
  pickArchiveFile,
  pickArchiveTrack,
  scoreArchiveFile,
  validateDownloadHit,
  validateSearchHit,
} from './download-source';

function track(title: string, artist: string, durationMs: number): CanonicalTrack {
  return {
    id: `itunes:${title}`,
    title,
    durationMs,
    artists: [{ id: `artist:${artist}`, name: artist, providerIds: {}, genres: [] }],
    providerIds: {},
    explicit: false,
  };
}

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

describe('parseArchiveLength', () => {
  it('parses seconds and clock formats', () => {
    expect(parseArchiveLength('176.17')).toBe(176_170);
    expect(parseArchiveLength(198.13)).toBe(198_130);
    expect(parseArchiveLength('3:18')).toBe(198_000);
    expect(parseArchiveLength('1:02:03')).toBe(3_723_000);
    expect(parseArchiveLength(undefined)).toBe(0);
    expect(parseArchiveLength('n/a')).toBe(0);
  });
});

describe('validateDownloadHit', () => {
  it('accepts a title/artist/duration match inside the tight window', () => {
    expect(
      validateDownloadHit(
        'Daylight',
        'Ariana Grande',
        'Daylight (Album Version)',
        'Ariana Grande',
        210_000,
        210_000
      )
    ).toBe(true);
  });

  it('rejects a same-title file by a different artist', () => {
    expect(
      validateDownloadHit(
        'Birds of a Feather',
        'Billie Eilish',
        'Birds of a feather',
        'All Star Trio and their Orchestra',
        198_000,
        210_000
      )
    ).toBe(false);
  });

  it('rejects a cover label even when the item creator matches the artist', () => {
    expect(
      validateDownloadHit(
        'Espresso',
        'Sabrina Carpenter',
        'Espresso',
        'Sabrina Carpenter',
        176_000,
        175_000,
        ['Soundcloudaud.com Espresso Sabrina Carpenter ( Best Cover Ever )']
      )
    ).toBe(false);
  });

  it('rejects a near-exact title whose length is off by more than the tolerance', () => {
    expect(
      validateDownloadHit(
        'Birds of a Feather',
        'Billie Eilish',
        'Birds of a Feather',
        'Billie Eilish',
        198_000,
        210_000
      )
    ).toBe(false);
  });

  it('accepts a valid 4-second intro/outro difference', () => {
    expect(
      validateDownloadHit(
        'Daylight',
        'Ariana Grande',
        'Daylight',
        'Ariana Grande',
        214_000,
        210_000
      )
    ).toBe(true);
  });
});

describe('pickArchiveTrack', () => {
  it('selects the matching track from a multi-track album item', () => {
    const picked = pickArchiveTrack(
      [
        {
          name: '01 Intro.mp3',
          format: 'VBR MP3',
          title: 'Intro',
          artist: 'Ariana Grande',
          length: '0:30',
        },
        {
          name: '05 Daylight.mp3',
          format: 'VBR MP3',
          title: 'Daylight',
          artist: 'Ariana Grande',
          length: '3:30',
        },
      ],
      track('Daylight', 'Ariana Grande', 210_000)
    );
    expect(picked?.file.name).toBe('05 Daylight.mp3');
  });

  it('returns null instead of taking an unrelated track from the item', () => {
    const picked = pickArchiveTrack(
      [
        {
          name: '01 Intro.mp3',
          format: 'VBR MP3',
          title: 'Intro',
          artist: 'Ariana Grande',
          length: '0:30',
        },
      ],
      track('Daylight', 'Ariana Grande', 210_000)
    );
    expect(picked).toBeNull();
  });

  it('rejects the Espresso cover item entirely', () => {
    const picked = pickArchiveTrack(
      [
        {
          name: 'soundcloudaud.com_Espresso - Sabrina Carpenter ( Best Cover Ever ).mp3',
          format: 'VBR MP3',
          artist: '',
          length: '176.17',
        },
      ],
      track('Espresso', 'Sabrina Carpenter', 175_000),
      ['Soundcloudaud.com Espresso Sabrina Carpenter ( Best Cover Ever )'],
      'Sabrina Carpenter'
    );
    expect(picked).toBeNull();
  });

  it('rejects the unrelated 1920s "Birds of a Feather" recording', () => {
    const picked = pickArchiveTrack(
      [
        {
          name: 'Birds of a feather - All Star Trio and their Orchestra.mp3',
          format: 'VBR MP3',
          title: 'Birds of a feather',
          artist: 'All Star Trio and their Orchestra, J. MCGOWAN, E. MORAN',
          length: '03:18',
        },
      ],
      track('Birds of a Feather', 'Billie Eilish', 210_000),
      ['Birds of a feather'],
      'All Star Trio and their Orchestra'
    );
    expect(picked).toBeNull();
  });

  it('uses the item creator when file-level artist metadata is absent', () => {
    const picked = pickArchiveTrack(
      [{ name: 'Daylight.mp3', format: 'VBR MP3', title: 'Daylight', length: '3:30' }],
      track('Daylight', 'Ariana Grande', 210_000),
      [],
      'Ariana Grande'
    );
    expect(picked?.file.name).toBe('Daylight.mp3');
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
    expect(hasForbiddenVariant('Levitating', 'A Tribute to Dua Lipa - Levitating')).toBe(true);
    expect(hasForbiddenVariant("Stayin' Alive", "Stayin' Alive")).toBe(false);
    expect(hasForbiddenVariant('Golden Hour', 'Golden Hour (Album Version)')).toBe(false);
  });

  it('refuses an unrequested remix when saving, but allows a requested one', () => {
    const request = { artist: 'Dua Lipa', durationMs: 203_000 };
    expect(
      validateDownloadHit(
        'Levitating',
        request.artist,
        'Levitating (Remix)',
        request.artist,
        request.durationMs,
        request.durationMs
      )
    ).toBe(false);
    expect(
      validateDownloadHit(
        'Levitating (Remix)',
        request.artist,
        'Levitating (Remix)',
        request.artist,
        request.durationMs,
        request.durationMs
      )
    ).toBe(true);
    // The inverse: asking for the remix must not save the plain studio file.
    expect(
      validateDownloadHit(
        'Levitating (Remix)',
        request.artist,
        'Levitating',
        request.artist,
        request.durationMs,
        request.durationMs
      )
    ).toBe(false);
  });
});
