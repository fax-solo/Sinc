import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LayoutChangeEvent } from 'react-native';
import React from 'react';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Button } from '../components/V2Button';
import { playerService } from '../../services/player/PlayerService';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { useLyricsStore, SYNC_STEP_MS } from '../../services/lyrics/lyricsStore';
import type { TrackLyrics } from '@sinc/shared';

interface LineLayout {
  y: number;
  height: number;
}

const LyricLines = React.memo(function LyricLines({
  lyrics,
  activeIndex,
  onSeekToLine,
  lineLayouts,
}: {
  lyrics: TrackLyrics;
  activeIndex: number;
  onSeekToLine: (line: { timeMs: number }) => void;
  lineLayouts: React.MutableRefObject<LineLayout[]>;
}) {
  return (
    <>
      {lyrics.lines.map((line, index) => {
        const isActive = index === activeIndex;
        const distance = Math.abs(index - activeIndex);
        return (
          <Pressable
            key={`${index}-${line.timeMs}`}
            onPress={() => onSeekToLine(line)}
            onLayout={(event) => {
              lineLayouts.current[index] = {
                y: event.nativeEvent.layout.y,
                height: event.nativeEvent.layout.height,
              };
            }}
            style={{ paddingVertical: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Seek to ${line.text}`}
          >
            <Text
              style={{
                fontSize: isActive ? 23 : 17,
                lineHeight: isActive ? 33 : 28,
                fontWeight: isActive ? '800' : '500',
                color: isActive ? v2Colors.accent : v2Colors.textPrimary,
                opacity: isActive ? 1 : 0.22 + 0.3 * Math.max(0, 1 - distance / 6),
              }}
            >
              {line.text}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
});

export function V2LyricsScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const track = usePlayerStore(selectCurrentTrack);
  const positionMs = usePlayerProgressStore((s) => s.positionMs);
  const loadLyrics = useLyricsStore((s) => s.loadLyrics);
  const adjustSync = useLyricsStore((s) => s.adjustSync);
  const resetSync = useLyricsStore((s) => s.resetSync);
  const isLoading = useLyricsStore((s) => s.loading[track?.id ?? ''] === true);
  const syncOffset = useLyricsStore((s) => s.offsets[track?.id ?? ''] ?? 0);

  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const lineLayouts = useRef<LineLayout[]>([]);
  const centeredIndex = useRef(-1);

  // Subscribe to the exact cache entry: calling getCached() during render
  // reads once and never re-renders when the fetch finishes unless something
  // else in the store happens to change. This keeps the screen in sync with
  // cache writes (including background cache warm after a download).
  const cachedLyrics = useLyricsStore((s) => (track ? s.cache[track.id] : undefined));
  const lyrics = track ? (cachedLyrics ?? null) : null;

  useEffect(() => {
    if (track) {
      lineLayouts.current = [];
      centeredIndex.current = -1;
      void loadLyrics(track);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced || lyrics.lines.length === 0) return -1;
    const position = positionMs + syncOffset;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i += 1) {
      if (position >= lyrics.lines[i].timeMs) index = i;
      else break;
    }
    return index;
  }, [lyrics, positionMs, syncOffset]);

  useEffect(() => {
    if (!lyrics?.synced || activeIndex < 0) return;
    const layout = lineLayouts.current[activeIndex];
    if (!layout || viewportHeight <= 0 || centeredIndex.current === activeIndex) return;
    centeredIndex.current = activeIndex;
    const target = Math.max(0, layout.y - viewportHeight / 2 + layout.height / 2);
    // Respect the OS reduce-motion setting: jump instead of smooth-scroll.
    scrollRef.current?.scrollTo({ y: target, animated: !reduceMotion });
  }, [activeIndex, viewportHeight, lyrics, reduceMotion]);

  const onViewportLayout = (event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height);
  };

  if (!track) {
    return (
      <View style={[styles.container, { backgroundColor: v2Colors.background }]}>
        <V2Text variant="body" color="textSecondary" style={{ textAlign: 'center', marginTop: 64 }}>
          Nothing playing yet.
        </V2Text>
      </View>
    );
  }

  if (isLoading && !lyrics) {
    return (
      <View style={[styles.container, { backgroundColor: v2Colors.background }]}>
        <ActivityIndicator size="large" color={v2Colors.accent} style={{ marginTop: 64 }} />
      </View>
    );
  }

  const hasContent = lyrics && (lyrics.lines.length > 0 || lyrics.plain);

  return (
    <View style={[styles.container, { backgroundColor: v2Colors.background }]}>
      {track.artworkUrl ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: track.artworkUrl }}
            style={styles.bgImage}
            resizeMode="cover"
            blurRadius={60}
          />
          <View style={styles.bgOverlay} />
        </View>
      ) : null}

      {hasContent ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          style={{ flex: 1 }}
          onLayout={onViewportLayout}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ height: viewportHeight * 0.3 }} />
          <V2Text variant="title" style={{ marginBottom: 4 }} numberOfLines={1}>
            {track.title}
          </V2Text>
          <V2Text
            variant="body"
            color="textSecondary"
            style={{ marginBottom: v2Spacing.md }}
            numberOfLines={1}
          >
            {track.artists.map((a) => a.name).join(', ')}
          </V2Text>
          {lyrics.synced ? (
            <LyricLines
              lyrics={lyrics}
              activeIndex={activeIndex}
              onSeekToLine={(line) => void playerService.seekTo(line.timeMs)}
              lineLayouts={lineLayouts}
            />
          ) : (
            <V2Text variant="body" color="textSecondary" style={{ lineHeight: 26 }}>
              {lyrics.plain}
            </V2Text>
          )}
          <View style={{ height: viewportHeight * 0.4 }} />
        </ScrollView>
      ) : (
        <View style={styles.emptyWrap}>
          <V2Text variant="title" style={{ textAlign: 'center' }}>
            No lyrics yet
          </V2Text>
          <V2Text variant="body" color="textSecondary" style={{ textAlign: 'center' }}>
            We couldn't find lyrics for this song.
          </V2Text>
          <View style={{ marginTop: v2Spacing.sm }}>
            <V2Button label="Try again" onPress={() => void loadLyrics(track)} compact />
          </View>
        </View>
      )}

      {hasContent && lyrics.synced ? (
        <View style={[styles.syncBar, { bottom: 32 + insets.bottom }]}>
          <Pressable
            onPress={() => adjustSync(track.id, -SYNC_STEP_MS)}
            hitSlop={10}
            style={styles.syncPill}
            accessibilityLabel="Shift lyrics later"
          >
            <V2Text variant="body" color="textSecondary">
              −
            </V2Text>
          </Pressable>
          <Pressable
            onPress={() => resetSync(track.id)}
            hitSlop={10}
            style={styles.syncPill}
            accessibilityLabel="Reset lyrics sync"
          >
            <V2Text variant="caption" color="textSecondary" style={{ fontWeight: '700' }}>
              {syncOffset === 0
                ? 'SYNC'
                : `${syncOffset > 0 ? '+' : ''}${(syncOffset / 1000).toFixed(2)}s`}
            </V2Text>
          </Pressable>
          <Pressable
            onPress={() => adjustSync(track.id, SYNC_STEP_MS)}
            hitSlop={10}
            style={styles.syncPill}
            accessibilityLabel="Shift lyrics earlier"
          >
            <V2Text variant="body" color="textSecondary">
              +
            </V2Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ scale: 1.4 }],
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 18, 18, 0.6)',
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  syncBar: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(24,24,24,0.8)',
    borderRadius: v2Radii.full,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  syncPill: {
    minWidth: 48,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
