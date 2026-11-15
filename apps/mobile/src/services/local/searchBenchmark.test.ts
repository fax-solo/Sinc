import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { mergeAndDedupeTracks, scoreTrack } from '@sinc/shared';

// Baseline implementation (for historical measurement)
function currentNormalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function currentScore(query: string, track: CanonicalTrack): number {
  const q = currentNormalizeText(query);
  const title = currentNormalizeText(track.title);
  let s = 0;
  if (title === q) s += 100;
  else if (title.startsWith(q)) s += 80;
  else if (title.includes(q)) s += 60;
  if (track.artists.some((a) => a.name.toLowerCase().includes(q))) s += 40;
  return s;
}

function currentMergeTrackResults(a: CanonicalTrack[], b: CanonicalTrack[]): CanonicalTrack[] {
  const merged: CanonicalTrack[] = [];
  const seen = new Set<string>();
  for (const track of [...a, ...b]) {
    const key = `${currentNormalizeText(track.title)}|${currentNormalizeText(track.artists[0]?.name ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(track);
  }
  return merged;
}

export interface BenchmarkTestCase {
  id: string;
  name: string;
  query: string;
  expectedRelevantIds: string[];
  mockProviderTracks: {
    itunes: CanonicalTrack[];
    deezer: CanonicalTrack[];
  };
}

const mockTrack = (
  id: string,
  title: string,
  artist: string,
  durationMs: number = 210000,
  provider: 'itunes' | 'deezer' = 'itunes'
): CanonicalTrack => ({
  id: `${provider}:${id}`,
  title,
  artists: [{ id: `${provider}:${artist}`, name: artist, providerIds: {}, genres: [] }],
  album: {
    id: `${provider}:alb-${id}`,
    title: `${title} - Album`,
    artist: { id: `${provider}:${artist}`, name: artist, providerIds: {}, genres: [] },
    trackCount: 10,
    providerIds: {},
    type: 'album',
  },
  durationMs,
  providerIds: { [provider]: id },
  explicit: false,
});

export const BENCHMARK_DATASET: BenchmarkTestCase[] = [
  {
    id: '1-exact-title-artist',
    name: 'Exact title and artist',
    query: 'After Dark - Mr.Kitty',
    expectedRelevantIds: ['itunes:after-dark', 'deezer:after-dark'],
    mockProviderTracks: {
      itunes: [
        mockTrack('after-dark', 'After Dark', 'Mr.Kitty', 259000, 'itunes'),
        mockTrack('after-hours', 'After Hours', 'The Weeknd', 361000, 'itunes'),
      ],
      deezer: [
        mockTrack('after-dark', 'After Dark', 'Mr.Kitty', 259000, 'deezer'),
        mockTrack(
          'after-dark-cover',
          'After Dark - Mr.Kitty Cover',
          'Indie Group',
          259000,
          'deezer'
        ),
      ],
    },
  },
  {
    id: '2-title-only',
    name: 'Title without artist',
    query: 'Blinding Lights',
    expectedRelevantIds: ['itunes:blinding-lights', 'deezer:blinding-lights'],
    mockProviderTracks: {
      itunes: [
        mockTrack('blinding-lights', 'Blinding Lights', 'The Weeknd', 200000, 'itunes'),
        mockTrack('random-lights', 'Lights', 'Ellie Goulding', 210000, 'itunes'),
      ],
      deezer: [mockTrack('blinding-lights', 'Blinding Lights', 'The Weeknd', 200000, 'deezer')],
    },
  },
  {
    id: '3-artist-only',
    name: 'Artist-only query',
    query: 'The Weeknd',
    expectedRelevantIds: ['itunes:blinding-lights', 'itunes:starboy'],
    mockProviderTracks: {
      itunes: [
        mockTrack('blinding-lights', 'Blinding Lights', 'The Weeknd', 200000, 'itunes'),
        mockTrack('starboy', 'Starboy', 'The Weeknd', 230000, 'itunes'),
        mockTrack('weekend-song', 'The Weekend', 'SZA', 240000, 'itunes'),
      ],
      deezer: [],
    },
  },
  {
    id: '4-partial-title',
    name: 'Partial title',
    query: 'Blind Light',
    expectedRelevantIds: ['itunes:blinding-lights'],
    mockProviderTracks: {
      itunes: [
        mockTrack('blinding-lights', 'Blinding Lights', 'The Weeknd', 200000, 'itunes'),
        mockTrack('blind-faith', 'Blind Faith', 'Dream Theater', 300000, 'itunes'),
      ],
      deezer: [],
    },
  },
  {
    id: '5-misspelled-title',
    name: 'Misspelled title',
    query: 'Blindng Lghts',
    expectedRelevantIds: ['itunes:blinding-lights'],
    mockProviderTracks: {
      itunes: [
        mockTrack('blinding-lights', 'Blinding Lights', 'The Weeknd', 200000, 'itunes'),
        mockTrack('other-song', 'Other Song', 'Other Artist', 180000, 'itunes'),
      ],
      deezer: [],
    },
  },
  {
    id: '6-arabic-title',
    name: 'Arabic title with diacritics/variations',
    query: 'مكانك',
    expectedRelevantIds: ['deezer:makanak'],
    mockProviderTracks: {
      itunes: [mockTrack('amr-tamally', 'تملي معاك', 'عمرو دياب', 260000, 'itunes')],
      deezer: [mockTrack('makanak', 'مَكَانَك', 'عمرو دياب', 240000, 'deezer')],
    },
  },
  {
    id: '7-mixed-arabic-english',
    name: 'Mixed Arabic and English',
    query: 'Amr Diab مكانك',
    expectedRelevantIds: ['deezer:makanak'],
    mockProviderTracks: {
      itunes: [],
      deezer: [
        mockTrack('makanak', 'مكانك', 'Amr Diab', 240000, 'deezer'),
        mockTrack('other-ar', 'يا انا يا لا', 'Amr Diab', 240000, 'deezer'),
      ],
    },
  },
  {
    id: '8-remix-query',
    name: 'Remix query',
    query: 'After Dark Remix',
    expectedRelevantIds: ['itunes:after-dark-remix'],
    mockProviderTracks: {
      itunes: [
        mockTrack('after-dark-orig', 'After Dark', 'Mr.Kitty', 259000, 'itunes'),
        mockTrack('after-dark-remix', 'After Dark (Remix)', 'Mr.Kitty', 265000, 'itunes'),
      ],
      deezer: [],
    },
  },
  {
    id: '9-live-version-query',
    name: 'Live-version query',
    query: 'Hotel California Live',
    expectedRelevantIds: ['itunes:hotel-calif-live'],
    mockProviderTracks: {
      itunes: [
        mockTrack('hotel-calif-orig', 'Hotel California', 'Eagles', 390000, 'itunes'),
        mockTrack('hotel-calif-live', 'Hotel California (Live)', 'Eagles', 420000, 'itunes'),
      ],
      deezer: [],
    },
  },
  {
    id: '10-empty-query',
    name: 'Empty result query',
    query: 'xyznonexistentquery987',
    expectedRelevantIds: [],
    mockProviderTracks: { itunes: [], deezer: [] },
  },
];

function runEvaluation(engine: 'baseline' | 'improved') {
  let totalPrecisionAt5 = 0;
  let totalRecallAt10 = 0;
  let totalMRR = 0;
  let totalNDCG = 0;
  let testedQueries = 0;

  const report: Array<{
    id: string;
    query: string;
    topResult: string | null;
    score: number;
    expected: string[];
    mrr: number;
    pAt5: number;
  }> = [];

  for (const testCase of BENCHMARK_DATASET) {
    if (testCase.expectedRelevantIds.length === 0) continue;
    testedQueries += 1;

    let ranked: Array<{ track: CanonicalTrack; score: number }>;

    if (engine === 'baseline') {
      const merged = currentMergeTrackResults(
        testCase.mockProviderTracks.itunes,
        testCase.mockProviderTracks.deezer
      );
      ranked = merged
        .map((track) => ({ track, score: currentScore(testCase.query, track) }))
        .sort((a, b) => b.score - a.score);
    } else {
      const allPool = [
        ...testCase.mockProviderTracks.itunes,
        ...testCase.mockProviderTracks.deezer,
      ];
      const merged = mergeAndDedupeTracks(allPool);
      ranked = merged
        .map((track) => {
          const res = scoreTrack(testCase.query, track);
          return { track, score: res.score };
        })
        .sort((a, b) => b.score - a.score);
    }

    const top5 = ranked.slice(0, 5);
    const relevantInTop5 = top5.filter((r) =>
      testCase.expectedRelevantIds.some((id) => r.track.id.endsWith(id.split(':')[1]))
    ).length;

    const pAt5 = relevantInTop5 / Math.min(5, top5.length || 1);
    const recallAt10 = relevantInTop5 / Math.max(1, testCase.expectedRelevantIds.length);

    let rankOfFirstRelevant = -1;
    for (let i = 0; i < ranked.length; i++) {
      if (
        testCase.expectedRelevantIds.some((id) => ranked[i].track.id.endsWith(id.split(':')[1]))
      ) {
        rankOfFirstRelevant = i + 1;
        break;
      }
    }
    const mrr = rankOfFirstRelevant > 0 ? 1 / rankOfFirstRelevant : 0;

    let dcg = 0;
    let idcg = 0;
    for (let i = 0; i < ranked.length; i++) {
      const isRel = testCase.expectedRelevantIds.some((id) =>
        ranked[i].track.id.endsWith(id.split(':')[1])
      );
      const rel = isRel ? 1 : 0;
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
    for (let i = 0; i < Math.min(testCase.expectedRelevantIds.length, ranked.length); i++) {
      idcg += (Math.pow(2, 1) - 1) / Math.log2(i + 2);
    }
    const ndcg = idcg > 0 ? dcg / idcg : 0;

    totalPrecisionAt5 += pAt5;
    totalRecallAt10 += recallAt10;
    totalMRR += mrr;
    totalNDCG += ndcg;

    report.push({
      id: testCase.id,
      query: testCase.query,
      topResult: ranked[0]
        ? `${ranked[0].track.title} - ${ranked[0].track.artists[0]?.name} (${ranked[0].track.id})`
        : null,
      score: ranked[0]?.score ?? 0,
      expected: testCase.expectedRelevantIds,
      mrr,
      pAt5,
    });
  }

  return {
    testedQueries,
    avgP5: totalPrecisionAt5 / testedQueries,
    avgRecall10: totalRecallAt10 / testedQueries,
    avgMRR: totalMRR / testedQueries,
    avgNDCG: totalNDCG / testedQueries,
    report,
  };
}

describe('Search Quality & Ranking Benchmark', () => {
  it('demonstrates measurable improvement from baseline to optimized engine', () => {
    const baseline = runEvaluation('baseline');
    const improved = runEvaluation('improved');

    console.log('\n================ SEARCH BENCHMARK COMPARISON ================');
    console.log(`Metric                     | Baseline | Improved | Absolute Gain`);
    console.log(`---------------------------+----------+----------+--------------`);
    console.log(
      `Mean Reciprocal Rank (MRR) | ${baseline.avgMRR.toFixed(3)}    | ${improved.avgMRR.toFixed(3)}    | +${(improved.avgMRR - baseline.avgMRR).toFixed(3)}`
    );
    console.log(
      `Normalized DCG (NDCG)      | ${baseline.avgNDCG.toFixed(3)}    | ${improved.avgNDCG.toFixed(3)}    | +${(improved.avgNDCG - baseline.avgNDCG).toFixed(3)}`
    );
    console.log(
      `Precision@5                | ${(baseline.avgP5 * 100).toFixed(1)}%    | ${(improved.avgP5 * 100).toFixed(1)}%    | +${((improved.avgP5 - baseline.avgP5) * 100).toFixed(1)}%`
    );
    console.log(
      `Recall@10                  | ${(baseline.avgRecall10 * 100).toFixed(1)}%    | ${(improved.avgRecall10 * 100).toFixed(1)}%   | +${((improved.avgRecall10 - baseline.avgRecall10) * 100).toFixed(1)}%`
    );
    console.log(`=============================================================\n`);

    console.log('Query-Level Comparison:');
    for (let i = 0; i < baseline.report.length; i++) {
      const b = baseline.report[i];
      const imp = improved.report[i];
      console.log(`Query: "${b.query}"`);
      console.log(`  Baseline: top="${b.topResult}" (score: ${b.score}, MRR: ${b.mrr.toFixed(2)})`);
      console.log(
        `  Improved: top="${imp.topResult}" (score: ${imp.score}, MRR: ${imp.mrr.toFixed(2)})`
      );
    }

    // Verify measurable improvements
    expect(improved.avgMRR).toBeGreaterThan(baseline.avgMRR);
    expect(improved.avgNDCG).toBeGreaterThan(baseline.avgNDCG);
    expect(improved.avgMRR).toBe(1.0); // 100% top-1 relevant hits on the benchmark dataset!
  });
});
