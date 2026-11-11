import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { EmptyState, ErrorState, SkeletonBlock } from '../components/State';
import { SeekBar } from '../components/Playback';
import { colors, spacing } from '../theme';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { playerService } from '../../services/player/PlayerService';
import { useLyricsStore, SYNC_STEP_MS, SYNC_MAX_MS } from '../../services/lyrics/lyricsStore';
import { formatDuration } from '../../utils/format';
import type { RootStackParamList } from '../../app/navigation/types';

const MANUAL_SCROLL_TIMEOUT = 4500;

export function LyricsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((state) => state.status);
  const positionMs = usePlayerProgressStore((state) => state.positionMs);
  const durationMs = usePlayerProgressStore((state) => state.durationMs);
  const lyrics = useLyricsStore((state) => (track ? state.cache[track.id] ?? null : null));
  const loading = useLyricsStore((state) => (track ? Boolean(state.loading[track.id]) : false));
  const offset = useLyricsStore((state) => (track ? state.offsets[track.id] ?? 0 : 0));
  const loadLyrics = useLyricsStore((state) => state.loadLyrics);
  const clearLyrics = useLyricsStore((state) => state.clearLyrics);
  const adjustSync = useLyricsStore((state) => state.adjustSync);
  const resetSync = useLyricsStore((state) => state.resetSync);

  const scrollRef = useRef<ScrollView>(null);
  const linePositions = useRef<Record<number, number>>({});
  const manualUntil = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attemptedTrackId, setAttemptedTrackId] = useState<string | null>(null);
  const [forceLoading, setForceLoading] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    linePositions.current = {};
    if (!track) return;
    if (lyrics && (lyrics.lines.length > 0 || lyrics.plain)) return;
    let active = true;
    void loadLyrics(track).then(() => {
      if (active) setAttemptedTrackId(track.id);
    });
    return () => {
      active = false;
    };
    // Deliberately keyed by track; a cached plain/synced lyric needs no refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    []
  );

  const synced = lyrics?.synced === true && lyrics.lines.length > 0;
  const activeIndex = useMemo(() => {
    if (!synced || !lyrics) return -1;
    const effective = positionMs + offset;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i += 1) {
      if (lyrics.lines[i].timeMs <= effective) index = i;
      else break;
    }
    return index;
  }, [synced, lyrics, positionMs, offset]);

  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const scrollToActive = (index: number) => {
    const y = linePositions.current[index];
    if (y == null) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - height * 0.34),
      animated: true,
    });
  };

  useEffect(() => {
    if (!synced || manual || activeIndex < 0) return;
    scrollToActive(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, synced, manual, height]);

  if (!track) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ paddingHorizontal: spacing.md, flexDirection: 'row' }}>
          <IconButton
            icon="chevron-down"
            label="Close lyrics"
            size={42}
            background={colors.card}
            onPress={() => navigation.goBack()}
          />
        </View>
        <EmptyState
          icon="mic-off-outline"
          title="Nothing playing"
          message="Start a song to see its lyrics here."
          actionLabel="Find music"
          onAction={() => navigation.navigate('Main', { screen: 'Search' })}
        />
      </View>
    );
  }

  const retry = async () => {
    setForceLoading(true);
    setAttemptedTrackId(null);
    clearLyrics(track.id);
    await loadLyrics(track);
    setAttemptedTrackId(track.id);
    setForceLoading(false);
  };

  const hasLyrics = Boolean(lyrics && (lyrics.lines.length > 0 || lyrics.plain));
  const attempted =
    (attemptedTrackId === track.id && !loading) || hasLyrics;
  const noLyricsFound =
    attempted &&
    !loading &&
    !forceLoading &&
    lyrics != null &&
    lyrics.lines.length === 0 &&
    !lyrics.plain;
  const failed = attempted && !loading && !forceLoading && lyrics == null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.borderSoft,
        }}
      >
        <IconButton
          icon="chevron-down"
          label="Close lyrics"
          size={38}
          background={colors.card}
          onPress={() => navigation.goBack()}
        />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="micro" style={{ color: colors.textSecondary }}>
            LYRICS
          </Text>
          <Text variant="bodyStrong" numberOfLines={1} style={{ marginTop: 1 }}>
            {track.title}
          </Text>
        </View>
        <View style={{ width: 38, alignItems: 'center' }}>
          {synced ? (
            <Text variant="caption" style={{ color: colors.accent }}>
              synced
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.xl,
          paddingBottom: 220,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (activeIndexRef.current >= 0 && !manual) {
            requestAnimationFrame(() => scrollToActive(activeIndexRef.current));
          }
        }}
        onScrollBeginDrag={() => {
          manualUntil.current = Date.now() + MANUAL_SCROLL_TIMEOUT;
          setManual(true);
          if (scrollTimer.current) clearTimeout(scrollTimer.current);
          scrollTimer.current = setTimeout(() => {
            setManual(false);
            const index = activeIndexRef.current;
            if (index >= 0) scrollToActive(index);
          }, MANUAL_SCROLL_TIMEOUT);
        }}
      >
        {!hasLyrics && (loading || forceLoading || !attempted) ? (
          <View style={{ gap: spacing.lg, paddingTop: spacing.lg }}>
            <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
            {Array.from({ length: 8 }, (_, index) => (
              <SkeletonBlock
                key={index}
                height={index % 3 === 0 ? 22 : 18}
                width={index % 2 === 0 ? '82%' : '64%'}
              />
            ))}
          </View>
        ) : null}

        {failed ? (
          <ErrorState
            title="Could not load lyrics"
            message="LRCLIB could not be reached. Check your connection, then try again."
            onRetry={() => void retry()}
          />
        ) : null}

        {noLyricsFound ? (
          <EmptyState
            icon="mic-off-outline"
            title="No lyrics found"
            message="LRCLIB has no lyrics for this recording yet. Sinc will never fill in invented words."
            actionLabel="Search again"
            onAction={() => void retry()}
          />
        ) : null}

        {synced ? (
          <View>
            {lyrics?.lines.map((line, index) => {
              const active = index === activeIndex;
              const passed = index < activeIndex;
              return (
                <Pressable
                  key={`${line.timeMs}-${index}`}
                  onPress={() => {
                    manualUntil.current = 0;
                    setManual(false);
                    void playerService.seekTo(Math.max(0, line.timeMs - offset));
                  }}
                  onLayout={(event) => {
                    linePositions.current[index] = event.nativeEvent.layout.y;
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Seek to ${line.text}`}
                  style={({ pressed }) => ({
                    paddingVertical: 7,
                    opacity: pressed ? 0.55 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontSize: active ? 23 : 21,
                      lineHeight: active ? 32 : 30,
                      fontWeight: active ? '800' : '600',
                      color: active
                        ? colors.accentBright
                        : passed
                          ? colors.textMuted
                          : colors.textSecondary,
                    }}
                  >
                    {line.text || '♪'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : hasLyrics ? (
          <Text
            style={{
              fontSize: 18,
              lineHeight: 30,
              color: colors.textSecondary,
              fontWeight: '500',
            }}
          >
            {lyrics?.plain ??
              lyrics?.lines.map((line) => line.text).join('\n') ??
              ''}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          backgroundColor: 'rgba(11, 15, 14, 0.96)',
          borderTopWidth: 1,
          borderTopColor: colors.borderSoft,
          gap: spacing.sm,
        }}
      >
        <SeekBar onSeek={(value) => void playerService.seekTo(value)} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: -6 }}>
          <Text variant="caption">{formatDuration(positionMs)}</Text>
          <Text variant="caption">
            {durationMs > 0 ? formatDuration(durationMs) : track.durationMs > 0 ? formatDuration(track.durationMs) : '--:--'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <IconButton
            icon="play-skip-back"
            label="Previous track"
            size={38}
            onPress={() => void playerService.previous()}
          />
          <IconButton
            icon={status === 'playing' ? 'pause' : 'play'}
            label={status === 'playing' ? 'Pause' : 'Play'}
            size={48}
            background={colors.accent}
            color={colors.onAccent}
            onPress={() => void playerService.togglePlayPause()}
          />
          <IconButton
            icon="play-skip-forward"
            label="Next track"
            size={38}
            onPress={() => void playerService.next()}
          />
          <View style={{ flex: 1 }} />
          {synced ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <IconButton
                icon="remove"
                label="Show lyrics 250 milliseconds later"
                size={32}
                background={colors.card}
                onPress={() => adjustSync(track.id, -SYNC_STEP_MS)}
              />
              <Pressable
                onPress={() => resetSync(track.id)}
                accessibilityRole="button"
                accessibilityLabel="Reset lyric timing"
                style={{ minWidth: 58, alignItems: 'center', paddingVertical: 4 }}
              >
                <Text variant="caption" style={{ color: offset !== 0 ? colors.accent : colors.textMuted }}>
                  {offset === 0 ? 'SYNC' : `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(2)}s`}
                </Text>
                {offset !== 0 ? (
                  <Text variant="micro" style={{ fontSize: 8 }}>
                    RESET
                  </Text>
                ) : null}
              </Pressable>
              <IconButton
                icon="add"
                label="Show lyrics 250 milliseconds earlier"
                size={32}
                background={colors.card}
                onPress={() => adjustSync(track.id, SYNC_STEP_MS)}
              />
            </View>
          ) : null}
        </View>
        {synced && Math.abs(offset) >= SYNC_MAX_MS ? (
          <Text variant="caption" align="center" style={{ color: colors.warning }}>
            Maximum sync offset reached
          </Text>
        ) : null}
      </View>
    </View>
  );
}
