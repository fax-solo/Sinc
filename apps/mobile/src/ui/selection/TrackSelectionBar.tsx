import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';
import { Text } from '../components/Text';
import { IconButton, TextButton } from '../components/Buttons';

interface TrackSelectionBarProps {
  count: number;
  totalCount: number;
  allSelected: boolean;
  onCancel: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  children: ReactNode;
  /** Override for tab screens, whose layout already excludes the bottom dock. */
  bottomInset?: number;
}

/** In-flow selection toolbar; never covers the last rows of the list. */
export function TrackSelectionBar({
  count,
  totalCount,
  allSelected,
  onCancel,
  onSelectAll,
  onDeselectAll,
  children,
  bottomInset,
}: TrackSelectionBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: colors.backgroundRaised,
        borderTopWidth: 1,
        borderTopColor: colors.borderSoft,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: bottomInset ?? insets.bottom + spacing.sm,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <IconButton
          icon="close"
          label="Cancel selection"
          size={32}
          background={colors.card}
          onPress={onCancel}
        />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{count > 0 ? `${count} selected` : 'Select songs'}</Text>
          <Text variant="caption">
            {totalCount} song{totalCount === 1 ? '' : 's'} in this list
          </Text>
        </View>
        <TextButton
          label={allSelected ? 'Clear' : 'Select all'}
          onPress={allSelected ? onDeselectAll : onSelectAll}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        {children}
      </View>
    </View>
  );
}
