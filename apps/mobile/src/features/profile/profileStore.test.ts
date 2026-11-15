import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore, AVATAR_PRESETS, ACCENT_COLORS } from './profileStore';

describe('profileStore', () => {
  beforeEach(() => {
    useProfileStore.getState().resetProfile();
  });

  it('initializes with default values', () => {
    const state = useProfileStore.getState();
    expect(state.username).toBe('Solo');
    expect(state.bio).toBe('Music Lover 🎵');
    expect(state.theme).toBe('dark');
    expect(state.accentColor).toBe('#1ED760');
    expect(state.streakDays).toBe(7);
  });

  it('updates username and bio with truncation limit', () => {
    useProfileStore.getState().setUsername('SoloDev');
    expect(useProfileStore.getState().username).toBe('SoloDev');

    const longBio = 'a'.repeat(150);
    useProfileStore.getState().setBio(longBio);
    expect(useProfileStore.getState().bio.length).toBe(100);
  });

  it('updates appearance and theme settings', () => {
    useProfileStore.getState().setTheme('light');
    expect(useProfileStore.getState().theme).toBe('light');

    useProfileStore.getState().setAccentColor(ACCENT_COLORS[1].color);
    expect(useProfileStore.getState().accentColor).toBe(ACCENT_COLORS[1].color);
  });

  it('selects avatar preset correctly', () => {
    useProfileStore.getState().setAvatarId(AVATAR_PRESETS[2].id);
    expect(useProfileStore.getState().avatarId).toBe('avatar-3');
  });
});
