import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import LinearGradient from 'react-native-linear-gradient';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useTheme, type Theme } from '../../theme';
import { AppText } from '../../components/AppText';
import { playerService } from '../../services/player/PlayerService';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { useLyricsStore, SYNC_STEP_MS } from '../../services/lyrics/lyricsStore';
import type { TrackLyrics } from '@sinc/shared';

const ACTIVE_FONT_SIZE = 24;
const ACTIVE_LINE_HEIGHT = 36;
const INACTIVE_FONT_SIZE = 17;
const INACTIVE_LINE_HEIGHT = 30;
const LINE_PADDING_V = 14;
const GLOW_DURATION_MS = 2000;

/**
 * The active lyric line: white base text with a gradient + moving shine clipped
 * to the text shape. The gradient overlay fades in from 0 to 100% over two
 * seconds so the line "glows up" as it becomes current. The base text keeps the
 * line visible even if the masked overlay fails to paint on a platform.
 */
function ActiveLyricLine({ text }: { text: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [size, setSize] = useState({ width: 0, height: ACTIVE_LINE_HEIGHT });
  const [glow] = useState(() => new Animated.Value(0));
  const [shine] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const glowAnim = Animated.timing(glow, {
      toValue: 1,
      duration: GLOW_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    glowAnim.start();
    return () => glowAnim.stop();
  }, [glow]);

  useEffect(() => {
    if (size.width <= 0 || reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(shine, {
        toValue: 1,
        duration: 2600,
        easing: Easing.inOut(Easing.quad),
        // transform + opacity run off the JS thread so the shine never
        // competes with the progress ticks that drive the highlight.
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [shine, size.width, reduceMotion]);

  const translateX = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-size.width, size.width],
  });

  return (
    <View
      style={styles.activeWrap}
      onLayout={(event: LayoutChangeEvent) =>
        setSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      <Text style={styles.activeText}>{text}</Text>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]} pointerEvents="none">
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={<Text style={styles.activeText}>{text}</Text>}
        >
          <LinearGradient
            colors={[colors.accent, '#41E09A', colors.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.activeFill, { width: size.width, height: size.height }]}
          >
            <Animated.View
              style={[
                styles.shineBand,
                {
                  width: Math.max(size.width * 0.35, 40),
                  transform: [{ translateX }],
                },
              ]}
            />
          </LinearGradient>
        </MaskedView>
      </Animated.View>
    </View>
  );
}

interface LineLayout {
  y: number;
  height: number;
}

function InactiveLine({
  text,
  distance,
  colors,
}: {
  text: string;
  distance: number;
  colors: Theme['colors'];
}) {
  return (
    <Text
      style={[
        styles.inactiveText,
        {
          color: colors.textPrimary,
          fontSize: INACTIVE_FONT_SIZE,
          lineHeight: INACTIVE_LINE_HEIGHT,
          opacity: 0.25 + 0.3 * Math.max(0, 1 - distance / 6),
        },
      ]}
    >
      {text}
    </Text>
  );
}

const InactiveLineMemo = React.memo(InactiveLine);

interface LyricContentProps {
  lyrics: TrackLyrics;
  activeIndex: number;
  colors: Theme['colors'];
  onSeekToLine: (line: { timeMs: number }) => void;
  lineLayouts: React.MutableRefObject<LineLayout[]>;
}

/**
 * The synced line list. Memoized on `activeIndex` so the 500ms positionMs ticks
 * that don't cross a line boundary skip reconciling the whole list (which used
 * to re-render every Text every tick and made the highlight lag the audio).
 */
const LyricContent = React.memo(function LyricContent({
  lyrics,
  activeIndex,
  colors,
  onSeekToLine,
  lineLayouts,
}: LyricContentProps) {
  return (
    <>
      {lyrics.lines.map((line, index) => {
        const isActive = index === activeIndex;
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
            style={styles.lineWrap}
            accessibilityRole="button"
            accessibilityLabel={`Seek to ${line.text}`}
          >
            {isActive ? (
              <ActiveLyricLine text={line.text} />
            ) : (
              <InactiveLineMemo
                text={line.text}
                distance={Math.abs(index - activeIndex)}
                colors={colors}
              />
            )}
          </Pressable>
        );
      })}
    </>
  );
});

interface LyricsScreenProps {
  onLoadLyrics?: (trackId: string) => void;
}

export function LyricsScreen({ onLoadLyrics }: LyricsScreenProps) {
  const { colors, spacing } = useTheme();
  const track = usePlayerStore(selectCurrentTrack);
  const positionMs = usePlayerProgressStore((s) => s.positionMs);
  const getCached = useLyricsStore((s) => s.getCached);
  const loadLyrics = useLyricsStore((s) => s.loadLyrics);
  const adjustSync = useLyricsStore((s) => s.adjustSync);
  const resetSync = useLyricsStore((s) => s.resetSync);
  const isLoading = useLyricsStore((s) => s.loading[track?.id ?? ''] === true);
  const syncOffset = useLyricsStore((s) => s.offsets[track?.id ?? ''] ?? 0);

  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const lineLayouts = useRef<{ y: number; height: number }[]>([]);
  const centeredIndex = useRef(-1);

  const lyrics = track ? getCached(track.id) : null;

  useEffect(() => {
    if (track) {
      lineLayouts.current = [];
      centeredIndex.current = -1;
      onLoadLyrics?.(track.id);
      void loadLyrics(track);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced || lyrics.lines.length === 0) return -1;
    // `syncOffset` shifts when a line activates: positive makes the highlight
    // lead the audio, negative makes it lag.
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
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }, [activeIndex, viewportHeight, lyrics]);

  const onViewportLayout = (event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height);
  };

  const onSeekToLine = useCallback((line: { timeMs: number }) => {
    void playerService.seekTo(line.timeMs);
  }, []);

  const artworkUrl = track?.artworkUrl;

  if (!track) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppText variant="body" color="textSecondary" style={styles.centeredText}>
          Nothing playing yet.
        </AppText>
      </View>
    );
  }

  if (isLoading && !lyrics) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const hasContent = lyrics && (lyrics.lines.length > 0 || lyrics.plain);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {artworkUrl ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: artworkUrl }}
            style={styles.bgImage}
            resizeMode="cover"
            blurRadius={50}
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
          <View style={{ height: viewportHeight * 0.35 }} />
          {lyrics.synced ? (
            <LyricContent
              lyrics={lyrics}
              activeIndex={activeIndex}
              colors={colors}
              onSeekToLine={onSeekToLine}
              lineLayouts={lineLayouts}
            />
          ) : (
            <AppText variant="body" color="textSecondary" style={styles.plainText}>
              {lyrics.plain}
            </AppText>
          )}
          <View style={{ height: viewportHeight * 0.4 }} />
        </ScrollView>
      ) : (
        <View style={styles.emptyWrap}>
          <AppText variant="headline" color="textSecondary" style={styles.centeredText}>
            Lyrics not available
          </AppText>
          <Pressable
            onPress={() => track && void loadLyrics(track)}
            hitSlop={8}
            style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
          >
            <AppText variant="body" color="onAccent">
              Try again
            </AppText>
          </Pressable>
        </View>
      )}
      {hasContent && lyrics.synced ? (
        <View style={styles.syncControls}>
          <Pressable
            onPress={() => adjustSync(track.id, -SYNC_STEP_MS)}
            hitSlop={10}
            style={[styles.syncButton, { backgroundColor: 'rgba(24,24,24,0.75)' }]}
            accessibilityRole="button"
            accessibilityLabel="Shift lyrics later"
          >
            <AppText variant="caption" color="textSecondary">
              −
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => resetSync(track.id)}
            hitSlop={10}
            style={[styles.syncButton, { backgroundColor: 'rgba(24,24,24,0.75)' }]}
            accessibilityRole="button"
            accessibilityLabel="Reset lyrics sync"
          >
            <AppText variant="caption" color="textSecondary">
              {syncOffset === 0
                ? 'sync'
                : `${syncOffset > 0 ? '+' : ''}${(syncOffset / 1000).toFixed(2)}s`}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => adjustSync(track.id, SYNC_STEP_MS)}
            hitSlop={10}
            style={[styles.syncButton, { backgroundColor: 'rgba(24,24,24,0.75)' }]}
            accessibilityRole="button"
            accessibilityLabel="Shift lyrics earlier"
          >
            <AppText variant="caption" color="textSecondary">
              +
            </AppText>
          </Pressable>
        </View>
      ) : null}
      <View
        style={[
          styles.syncTime,
          { backgroundColor: 'rgba(24, 24, 24, 0.75)', paddingHorizontal: spacing.sm },
        ]}
      >
        <AppText variant="caption" color="textMuted">
          {Math.floor(positionMs / 1000)}s
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredText: {
    textAlign: 'center',
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ scale: 1.4 }],
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 18, 18, 0.55)',
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  lineWrap: {
    paddingVertical: LINE_PADDING_V,
    justifyContent: 'center',
  },
  activeWrap: {
    alignSelf: 'stretch',
  },
  activeText: {
    fontSize: ACTIVE_FONT_SIZE,
    lineHeight: ACTIVE_LINE_HEIGHT,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  activeFill: {
    overflow: 'hidden',
  },
  shineBand: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  inactiveText: {
    fontWeight: '500',
  },
  plainText: {
    marginTop: 8,
    lineHeight: 26,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  retryButton: {
    backgroundColor: '#1DB954',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  syncTime: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    borderRadius: 12,
    paddingVertical: 6,
  },
  syncControls: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  syncButton: {
    minWidth: 44,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
