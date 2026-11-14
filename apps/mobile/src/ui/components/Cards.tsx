import { memo, type ComponentProps, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import Ionicons from '@react-native-vector-icons/ionicons';
import { artworkUrl } from '../../api/artwork';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';
import { Artwork } from './Artwork';
import { RoundPlayButton } from './Buttons';

export function SectionRail({
  children,
  contentContainerStyle,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        { gap: spacing.sm, paddingRight: spacing.lg },
        contentContainerStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
}

interface CardShellProps {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  width: number;
}

function CardShell({ onPress, accessibilityLabel, children, width }: CardShellProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width,
        opacity: pressed ? 0.74 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      {children}
    </Pressable>
  );
}

function Caption({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 3, marginTop: 9 }}>
      <Text variant="bodyStrong" numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="small" numberOfLines={2} style={{ lineHeight: 16 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export const MediaCard = memo(function MediaCard({
  title,
  subtitle,
  artworkUri,
  onPress,
  width = 150,
  size = 150,
  radius = radii.md,
  circular = false,
}: {
  title: string;
  subtitle?: string;
  artworkUri?: string | null;
  onPress: () => void;
  width?: number;
  size?: number;
  radius?: number;
  circular?: boolean;
}) {
  return (
    <CardShell onPress={onPress} accessibilityLabel={title} width={width}>
      <Artwork
        uri={artworkUri}
        size={size}
        radius={circular ? size / 2 : radius}
        accessibilityLabel={`${title} artwork`}
      />
      <Caption title={title} subtitle={subtitle} />
    </CardShell>
  );
});

export const ArtistCard = memo(function ArtistCard({
  name,
  artworkUri,
  onPress,
}: {
  name: string;
  artworkUri?: string | null;
  onPress: () => void;
}) {
  return (
    <CardShell onPress={onPress} accessibilityLabel={name} width={112}>
      <Artwork
        uri={artworkUri}
        size={112}
        radius={56}
        accessibilityLabel={`${name} photo`}
      />
      <Text variant="bodyStrong" numberOfLines={1} style={{ marginTop: 8 }}>
        {name}
      </Text>
      <Text variant="caption">Artist</Text>
    </CardShell>
  );
});

export function FeaturedCard({
  eyebrow = 'MADE FOR YOU',
  title,
  description,
  artworkUri,
  onPress,
  onPlay,
  playing,
  loading,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  artworkUri?: string | null;
  onPress: () => void;
  onPlay: () => void;
  playing?: boolean;
  loading?: boolean;
}) {
  const image = artworkUrl(artworkUri);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description ?? ''}`}
      style={({ pressed }) => ({
        height: 190,
        borderRadius: radii.xl,
        overflow: 'hidden',
        backgroundColor: colors.card,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={['#1D3D2A', '#111816']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      )}
      <LinearGradient
        colors={['rgba(5, 10, 8, 0.18)', 'rgba(5, 10, 8, 0.94)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={{ flex: 1, justifyContent: 'flex-end', padding: spacing.lg }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="micro" style={{ color: colors.accentBright, marginBottom: 6 }}>
              {eyebrow}
            </Text>
            <Text variant="title" numberOfLines={2}>
              {title}
            </Text>
            {description ? (
              <Text variant="small" color="textSecondary" numberOfLines={2} style={{ marginTop: 4 }}>
                {description}
              </Text>
            ) : null}
          </View>
          <RoundPlayButton
            playing={Boolean(playing)}
            loading={loading}
            onPress={(event) => {
              // Do not let the card's "open collection" handler also fire.
              event.stopPropagation();
              onPlay();
            }}
            size={48}
            label={`Play ${title}`}
          />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export function CategoryTile({
  title,
  subtitle,
  colors: tileColors,
  icon,
  onPress,
}: {
  title: string;
  subtitle?: string;
  colors: [string, string];
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 92,
        borderRadius: radii.lg,
        overflow: 'hidden',
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <LinearGradient
        colors={tileColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flex: 1,
          padding: spacing.md,
          justifyContent: 'space-between',
        }}
      >
        <Text variant="bodyStrong" style={{ maxWidth: '80%' }} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.72)' }}>
            {subtitle}
          </Text>
        ) : null}
        <View style={{ position: 'absolute', right: 10, bottom: 8, opacity: 0.82 }}>{icon}</View>
      </LinearGradient>
    </Pressable>
  );
}

export function IconDisc({
  icon,
  size = 42,
  background = colors.card,
  color = colors.text,
  onPress,
  label,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  size?: number;
  background?: string;
  color?: string;
  onPress?: () => void;
  label?: string;
}) {
  if (!onPress) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={Math.round(size * 0.46)} color={color} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? 'Action'}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={color} />
    </Pressable>
  );
}
