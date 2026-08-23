import { TextInput, View } from 'react-native';
import { AppText } from '../../../components/AppText';
import { useTheme } from '../../../theme';

interface AuthTextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  textContentType?: 'username' | 'emailAddress' | 'password' | 'newPassword' | 'name';
  autoComplete?: 'username' | 'email' | 'password' | 'new-password' | 'name';
}

export function AuthTextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  autoCapitalize = 'none',
  keyboardType = 'default',
  textContentType,
  autoComplete,
}: AuthTextFieldProps) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="small" color="textSecondary" style={{ marginBottom: spacing.xxs }}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        textContentType={textContentType}
        autoComplete={autoComplete}
        style={{
          backgroundColor: colors.surfaceElevated,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          color: colors.textPrimary,
          fontSize: 16,
        }}
      />
    </View>
  );
}
