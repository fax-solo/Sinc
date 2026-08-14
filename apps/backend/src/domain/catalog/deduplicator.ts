import {
  type CanonicalTrack,
  type RawTrack,
  durationsCompatible,
  trackFingerprint,
} from '@sinc/shared';
import { PROVIDER_CONFIDENCE, completenessScore, toCanonicalTrack } from './normalize.js';

export interface DeduplicatedTrack {
  /** Merged canonical track (all providerIds, most complete fields). */
  track: CanonicalTrack;
  /** The group representative the merged record was built from. */
  representative: RawTrack;
}

/**
 * Group raw candidates into deduplicated canonical tracks.
 * Strategy (ARCHITECTURE_PROVIDERS.md):
 *  - ISRC is the strongest signal; normalized fingerprint is the fallback.
 *  - Two records join a group when they share an ISRC or a fingerprint.
 *  - The representative is the most complete, then highest provider
 *    confidence, then best duration agreement with the group median.
 *  - The merged result keeps every providerId and prefers the most complete
 *    values for optional fields.
 */
export class Deduplicator {
  deduplicate(results: readonly RawTrack[]): CanonicalTrack[] {
    return this.deduplicateDetailed(results).map((entry) => entry.track);
  }

  deduplicateDetailed(results: readonly RawTrack[]): DeduplicatedTrack[] {
    return this.buildGroups(results).map((group) => ({
      track: this.mergeGroup(group),
      representative: this.pickRepresentative(group),
    }));
  }

  private buildGroups(results: readonly RawTrack[]): RawTrack[][] {
    const keys = new Map<string, number>();
    const groups: RawTrack[][] = [];

    for (const raw of results) {
      const candidateKeys: string[] = [];
      if (raw.isrc) candidateKeys.push(`isrc:${raw.isrc.toUpperCase()}`);
      candidateKeys.push(`fp:${trackFingerprint(raw.title, raw.artistNames)}`);

      let groupIndex: number | null = null;
      for (const key of candidateKeys) {
        const existing = keys.get(key);
        if (existing != null) {
          groupIndex = existing;
          break;
        }
      }

      if (groupIndex == null) {
        groupIndex = groups.length;
        groups.push([]);
      }

      groups[groupIndex]!.push(raw);
      for (const key of candidateKeys) {
        if (!keys.has(key)) keys.set(key, groupIndex);
      }
    }

    return groups;
  }

  /** Pick the group representative using the documented tie-break order. */
  pickRepresentative(group: readonly RawTrack[]): RawTrack {
    let best = group[0]!;
    for (const candidate of group.slice(1)) {
      if (this.isBetter(candidate, best, group)) best = candidate;
    }
    return best;
  }

  private isBetter(candidate: RawTrack, current: RawTrack, group: readonly RawTrack[]): boolean {
    const c = completenessScore(candidate);
    const k = completenessScore(current);
    if (c !== k) return c > k;
    const cp = PROVIDER_CONFIDENCE[candidate.provider] ?? 0.5;
    const kp = PROVIDER_CONFIDENCE[current.provider] ?? 0.5;
    if (cp !== kp) return cp > kp;
    const cAgreement = this.agreementCount(candidate, group);
    const kAgreement = this.agreementCount(current, group);
    if (cAgreement !== kAgreement) return cAgreement > kAgreement;
    return (
      `${candidate.provider}:${candidate.providerId}` < `${current.provider}:${current.providerId}`
    );
  }

  /** How many group members have durations compatible with this record? */
  private agreementCount(candidate: RawTrack, group: readonly RawTrack[]): number {
    let count = 0;
    for (const other of group) {
      if (durationsCompatible(candidate.durationMs, other.durationMs)) count += 1;
    }
    return count;
  }

  /** Merge one group into a single canonical track (deterministic output). */
  private mergeGroup(group: RawTrack[]): CanonicalTrack {
    const representative = this.pickRepresentative(group);
    const merged = toCanonicalTrack(representative);

    const providerIds: Record<string, string> = {};
    for (const member of group) {
      providerIds[member.provider] = member.providerId;
    }
    merged.providerIds = providerIds;

    merged.isrc = this.preferIsrc(group);
    merged.durationMs = this.preferDuration(group, representative.durationMs) ?? merged.durationMs;
    merged.artworkUrl = this.preferField(group, 'artworkUrl') ?? merged.artworkUrl;
    merged.releaseDate = this.preferField(group, 'releaseDate') ?? merged.releaseDate;
    merged.explicit = (merged.explicit ?? group.some((m) => m.explicit === true)) || undefined;
    merged.version = this.preferField(group, 'version') ?? merged.version;
    merged.trackNumber = this.preferField(group, 'trackNumber') ?? merged.trackNumber;

    return merged;
  }

  private preferIsrc(group: readonly RawTrack[]): string | undefined {
    const isrcs = [...new Set(group.map((m) => m.isrc).filter((v): v is string => !!v))];
    return isrcs.length > 0 ? isrcs[0] : undefined;
  }

  private preferDuration(
    group: readonly RawTrack[],
    fallback: number | undefined,
  ): number | undefined {
    const known = group.map((m) => m.durationMs).filter((v): v is number => v != null && v > 0);
    if (known.length === 0) return undefined;
    const median = [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)]!;
    return [...known].sort((a, b) => Math.abs(a - median) - Math.abs(b - median))[0] ?? fallback;
  }

  private preferField<T extends keyof RawTrack>(
    group: readonly RawTrack[],
    field: T,
  ): RawTrack[T] | undefined {
    for (const member of group) {
      if (member[field] != null) return member[field];
    }
    return undefined;
  }
}
