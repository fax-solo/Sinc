import React, { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import Video from 'react-native-video';
import { createAudioEngine } from './engine';

const engine = createAudioEngine();

/**
 * Requests the Android 13+ POST_NOTIFICATIONS runtime permission once the
 * first playback starts, so the media notification can show. Denial only
 * hides the notification; playback is unaffected.
 */
async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (permission) {
      await PermissionsAndroid.request(permission);
    }
  } catch {
    // Ignore: notification suppressed, playback unaffected.
  }
}

/**
 * Invisible video element that keeps audio playing while any screen is
 * focused. Rendered once at the app root; control flows through the engine
 * singleton so the playback store never touches RN specifics. The store
 * registers the engine's event handler; this component only attaches the
 * native element ref and re-renders on engine snapshot changes.
 *
 * Media3 (Android) / AVPlayer (iOS) background playback is enabled via the
 * notification-controls props: while audio is loaded the playback service
 * shows a media notification with lock-screen controls, and playback keeps
 * running when the app is backgrounded.
 */
export default function AudioHost(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(engine.snapshot());
  const requestedPermissionRef = useRef(false);

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setSnapshot(engine.snapshot()));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (snapshot.uri && !requestedPermissionRef.current) {
      requestedPermissionRef.current = true;
      void ensureNotificationPermission();
    }
  }, [snapshot.uri]);

  const metadata = snapshot.metadata;
  const source = snapshot.uri
    ? {
        uri: snapshot.uri,
        headers: snapshot.headers,
        metadata: metadata
          ? {
              title: metadata.title,
              subtitle: metadata.subtitle,
              artist: metadata.artist,
              description: metadata.artist,
            }
          : undefined,
      }
    : undefined;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <Video
        ref={(ref) => engine.attachVideo(ref)}
        source={source}
        paused={snapshot.paused}
        playInBackground
        ignoreSilentSwitch="ignore"
        showNotificationControls
        resizeMode="contain"
        onLoad={(event) => engine.handleLoaded(event.duration)}
        onProgress={(event) => engine.handleProgress(event.currentTime, 0)}
        onEnd={engine.handleEnded}
        onError={(event) =>
          engine.handleError(
            event.error.errorCode ?? 'UNKNOWN',
            event.error.errorString ?? 'Unknown error',
          )
        }
        onAudioBecomingNoisy={engine.handleNoisy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
