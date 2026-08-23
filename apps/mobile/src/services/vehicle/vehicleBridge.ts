/**
 * Vehicle / Android Auto extension point (M7.4).
 *
 * ARCHITECTURE HOOK for in-car playback. Android Auto surfaces media via a
 * MediaBrowserService exposing the media session; CarPlay uses
 * MPPlayableContentManager. The app already runs playback through a Media3
 * `MediaSessionService` (PlaybackService.kt), which is the source a
 * MediaBrowserService would wrap.
 *
 * To implement:
 *  1. Add a `MediaBrowserService`/`MediaSessionService` wrapper exposing the
 *     queue + transport controls, and connect it to the existing
 *     `PlaybackService` session.
 *  2. Expose it to JS as a native module (SincVehicle) implementing
 *     `VehicleBridge` below, then swap `createUnavailableVehicle()` for the
 *     live module.
 *  3. Have JS push the play queue into the vehicle extension whenever the
 *     queue changes so the car UI matches the phone.
 */
import type { CanonicalTrack } from '@sinc/shared';

/** A single playable row for the vehicle media browser. */
export interface VehicleQueueItem {
  trackId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
}

export interface VehicleBridge {
  /** True when the native vehicle module is linked. */
  available(): boolean;
  /** Publishes the current queue + index to the vehicle media browser. */
  publishQueue(queue: VehicleQueueItem[], currentIndex: number): Promise<void>;
  /** Transport command from the car (maps to the media session). */
  sendTransportCommand(command: 'play' | 'pause' | 'next' | 'previous'): Promise<void>;
}

function unavailable(method: string): () => Promise<never> {
  return async () => {
    throw new Error(`Native vehicle method "${method}" is unavailable.`);
  };
}

function createUnavailableVehicle(): VehicleBridge {
  return {
    available: () => false,
    publishQueue: unavailable('vehicle.publishQueue'),
    sendTransportCommand: unavailable('vehicle.sendTransportCommand'),
  };
}

export const vehicleBridge: VehicleBridge = createUnavailableVehicle();

/** Maps a canonical track onto the vehicle queue item shape. */
export function toVehicleItem(track: CanonicalTrack): VehicleQueueItem {
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artists.map((a) => a.name).join(', '),
    artworkUrl: track.artworkUrl,
  };
}
