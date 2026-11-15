import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { PrimaryButton, TextButton } from './Buttons';
import { colors, radii, spacing } from '../theme';
import { usePersonalizationStore } from '../../services/local/personalizationStore';

export const STARTER_GENRES = [
  'Pop',
  'Rock',
  'Hip-Hop',
  'Electronic',
  'R&B',
  'Indie',
  'Alternative',
  'Jazz',
  'Classical',
  'Metal',
  'Folk',
  'Dance',
  'Latin',
  'K-Pop',
];

export const STARTER_ARTISTS = [
  'The Weeknd',
  'Daft Punk',
  'Radiohead',
  'Queen',
  'Taylor Swift',
  'Kendrick Lamar',
  'Arctic Monkeys',
  'Coldplay',
  'Drake',
  'Billie Eilish',
  'Pink Floyd',
  'Eminem',
];

interface TastePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export function TastePickerModal({ visible, onDismiss }: TastePickerModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const completeOnboarding = usePersonalizationStore((state) => state.completeOnboarding);
  const skipOnboarding = usePersonalizationStore((state) => state.skipOnboarding);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const toggleArtist = (artist: string) => {
    setSelectedArtists((prev) =>
      prev.includes(artist) ? prev.filter((a) => a !== artist) : [...prev, artist]
    );
  };

  const handleSave = () => {
    completeOnboarding(selectedGenres, selectedArtists);
    onDismiss();
  };

  const handleSkip = () => {
    skipOnboarding();
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleSkip}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            maxHeight: '85%',
            paddingTop: spacing.lg,
            paddingHorizontal: spacing.lg,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.xs,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>
                Tailor Your Music Taste
              </Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
                Pick a few genres and artists to jump-start your recommendations.
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={handleSkip}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ marginVertical: spacing.md }}>
            {/* Genres Section */}
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: colors.text,
                marginBottom: spacing.sm,
              }}
            >
              Favorite Genres
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.lg }}>
              {STARTER_GENRES.map((genre) => {
                const active = selectedGenres.includes(genre);
                return (
                  <Pressable
                    key={genre}
                    onPress={() => toggleGenre(genre)}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs + 2,
                      borderRadius: radii.full,
                      backgroundColor: active ? colors.accent : colors.input,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.borderSoft,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: active ? '700' : '500',
                        color: active ? colors.onAccent : colors.text,
                      }}
                    >
                      {genre}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Artists Section */}
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: colors.text,
                marginBottom: spacing.sm,
              }}
            >
              Favorite Artists
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.lg }}>
              {STARTER_ARTISTS.map((artist) => {
                const active = selectedArtists.includes(artist);
                return (
                  <Pressable
                    key={artist}
                    onPress={() => toggleArtist(artist)}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs + 2,
                      borderRadius: radii.full,
                      backgroundColor: active ? colors.accentSoft : colors.input,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.borderSoft,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: active ? '700' : '500',
                        color: active ? colors.accent : colors.text,
                      }}
                    >
                      {artist}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* Bottom Actions */}
          <View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
            <PrimaryButton
              label={
                selectedGenres.length > 0 || selectedArtists.length > 0
                  ? `Save Preferences (${selectedGenres.length + selectedArtists.length})`
                  : 'Save Preferences'
              }
              onPress={handleSave}
            />
            <TextButton label="Skip for now" onPress={handleSkip} color={colors.textSecondary} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
