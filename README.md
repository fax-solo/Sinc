# Sinc — play any song, keep any song 💛

Sinc is a free Android music app. Search any song, play it instantly, sing along with synced
lyrics, and download the ones you love — as normal, properly-tagged audio files that show up in
**every other music player** on your phone.

No account. No subscription. Runs entirely on your phone.

---

## ⬇️ Download & install

1. Open the [**latest release**](https://github.com/fax-solo/Sinc/releases/latest) page.
2. Download the `sinc-*.*.*-*.apk` file.
3. Open the downloaded file. If Android asks, allow installing apps from your browser/files
   (one-time prompt). Done! 🎉

**Requires:** an Android phone, 8.0 or newer (works best on 64-bit phones — realistically
anything from ~2016 on — and tested on Android 15).

### Keeping the app updated

Inside the app, go to **Library → Settings → About & updates**. When a new release is out,
Sinc tells you and offers a direct download — no Play Store, no manual uninstall.

---

## ✨ Features

### 🎧 Discover & play

- Search any song, artist or album — Sinc finds a working audio source for you automatically.
- A home feed with fresh picks that change every day.
- Play in the background — reply to texts while the chorus drops. 😉
- Full queue control: jump around, reshuffle feelings, no interruptions.

### 📥 Download & own it

- **Real downloads** — not a cache only you can find. Songs are saved to `Music/Sinc` in your
  phone storage as proper `.m4a` / `.mp3` files.
- **Artist, title & album tags + cover art baked in** — other music players (YouTube Music,
  Samsung Music, anything) show the song correctly, cover and all.
- Download a whole **Spotify playlist** in one tap: paste the playlist, Sinc queues it up and
  downloads in the background.
- A live **download queue** with real progress — you can see it move, cancel anything, retry
  the ones that failed.
- Smart matching that refuses garbage: slowed & reverb remixes, sped-up nightcore, live
  "but it's actually a re-upload with a different duration" traps get rejected, and you get the
  actual song (or an honest failure telling you it couldn't validate a clean source).

### 🎤 Lyrics

- **Synced lyrics**: they scroll with the song as it plays.
- Works for **Arabic** too — twin-letter variants (ة/ه, ى/ي, Persian forms) are folded so
  lyrics for Arabic songs actually load.
- Falls back to plain (un-synced) lyrics when no timed version exists.

### ❤️ Your library

- Liked songs, recently played, playlists — offline, on-device.
- Your downloads live in the **Library** section; the **Settings** section keeps things tidy.

### 🔄 Updates built-in

- The app checks GitHub Releases itself and offers to update with one tap.

---

## 🚀 First steps

1. Open Sinc. Search for a song in the search bar.
2. Tap a result — it starts playing, and lyrics load underneath it.
3. Like it? Tap **download** (↓). Watch the queue chew through, check your progress.
4. Open any other music player — your song is there, named and tagged like a normal file.
5. Paste a Spotify playlist URL via **Library → Download a playlist** and let it run while
   your phone charges.

---

## 🛠 For developers

- Tech: React Native (TypeScript) app with an on-device engine (Python + yt-dlp + ffmpeg)
  bundled in the APK — the app runs fully local, no server required. A prototype TypeScript
  server lives under [`apps/server`](apps/server).
- Build from source: `npm install`, then build the engine binaries with
  `bash scripts/build-mobile-media-binaries.sh`, then:

  ```bash
  cd apps/mobile/android
  ./gradlew assembleRelease     # APK lands in apps/mobile/android/app/build/outputs/apk/release/
  ```

- The bundled engine binaries are **not** committed; the script above (and the release CI)
  fetches/builds them.
- Cutting an official release: see [`docs/RELEASING.md`](docs/RELEASING.md).
- Full architecture docs live in the [`ARCHITECTURE_*.md`](.) files at the repo root, plus
  status notes in [`docs/`](docs/) (QA, milestones).

---

## ⚖️ A note on responsibility

Sinc streams and downloads from the sources it finds and is made **for personal use**.
Please respect the copyright law where you live and the terms of the services that Sinc
searches. Don't redistribute what you download.

---

<p align="center">made with 💛</p>
