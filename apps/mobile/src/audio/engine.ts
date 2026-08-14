/**
 * Audio engine abstraction. The real implementation drives a hidden
 * react-native-video element (rendered by AudioHost); unit tests inject a
 * NullAudioEngine so the playback store stays testable without native code.
 */

/** Track info shown in the media notification / lock screen. */
export interface EngineMetadata {
  title: string;
  artist?: string;
  subtitle?: string;
}

export interface EngineSnapshot {
  uri: string | null;
  headers: Record<string, string> | undefined;
  metadata: EngineMetadata | undefined;
  paused: boolean;
  rate: number;
}

export interface EngineEvents {
  onLoaded(durationMs: number): void;
  onProgress(positionMs: number, durationMs: number): void;
  onEnded(): void;
  onError(code: string, message: string): void;
  /** Interruption (headset unplug, phone call, another app). */
  onAudioBecomingNoisy(): void;
}

export interface AudioEngine {
  /** React side calls this with the current handler whenever it changes. */
  setHandler(handler: EngineEvents | null): void;
  load(uri: string, headers?: Record<string, string>, metadata?: EngineMetadata): Promise<void>;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  release(): void;
  /** Snapshot for the React host component to render. */
  snapshot(): EngineSnapshot;
  subscribe(listener: () => void): () => void;
  /** Host component attaches the native element and forwards its events. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachVideo(video: any): void;
  handleLoaded(durationSeconds: number): void;
  handleProgress(currentSeconds: number, durationSeconds: number): void;
  handleEnded(): void;
  handleError(code: string, message: string): void;
  handleNoisy(): void;
}

let instance: AudioEngine | null = null;

export function createAudioEngine(): AudioEngine {
  if (!instance) instance = new ReactVideoAudioEngine();
  return instance;
}

/** Test seam. */
export function __setAudioEngine(engine: AudioEngine | null): void {
  instance = engine;
}

/**
 * Drives a hidden <Video> element via a render snapshot; the Video's events
 * (load/progress/end/error/noisy) are forwarded to the playback store.
 * Import of react-native-video is deferred so unit tests can mock this module.
 */
export class ReactVideoAudioEngine implements AudioEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private video: any = null;
  private handler: EngineEvents | null = null;
  private listeners = new Set<() => void>();
  private snap: EngineSnapshot = {
    uri: null,
    headers: undefined,
    metadata: undefined,
    paused: true,
    rate: 1,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachVideo(video: any): void {
    this.video = video;
  }

  setHandler(handler: EngineEvents | null): void {
    this.handler = handler;
  }

  async load(
    uri: string,
    headers?: Record<string, string>,
    metadata?: EngineMetadata,
  ): Promise<void> {
    this.snap = { ...this.snap, uri, headers, metadata, paused: false, rate: 1 };
    this.notify();
  }

  play(): void {
    if (!this.snap.uri) return;
    this.snap = { ...this.snap, paused: false };
    this.notify();
  }

  pause(): void {
    this.snap = { ...this.snap, paused: true };
    this.notify();
  }

  seek(positionMs: number): void {
    this.video?.seek(positionMs / 1000);
  }

  release(): void {
    this.snap = { uri: null, headers: undefined, metadata: undefined, paused: true, rate: 1 };
    this.video = null;
    this.notify();
  }

  snapshot(): EngineSnapshot {
    return this.snap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** --- Event forwarding (called by the AudioHost component) --- */

  handleLoaded(durationSeconds: number): void {
    this.handler?.onLoaded(durationSeconds * 1000);
  }

  handleProgress(currentSeconds: number, durationSeconds: number): void {
    this.handler?.onProgress(currentSeconds * 1000, durationSeconds * 1000);
  }

  handleEnded(): void {
    this.handler?.onEnded();
  }

  handleError(code: string, message: string): void {
    this.handler?.onError(code, message);
  }

  handleNoisy(): void {
    this.handler?.onAudioBecomingNoisy();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
