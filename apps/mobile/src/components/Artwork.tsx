import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Square artwork placeholder: shows the image when present, else an initial. */
export default function Artwork({
  label,
  size = 128,
  radius = 16,
}: {
  label: string;
  size?: number;
  radius?: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: tokens.colors.primaryContainer,
        },
      ]}
    >
      <Text
        style={[
          tokens.typography.title1,
          {
            color: tokens.colors.onPrimaryContainer,
            fontSize: size * 0.4,
            lineHeight: size * 0.52,
          },
        ]}
      >
        {(label || '♪').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
