#!/usr/bin/env bash
# Builds the bundled on-device media engine for SincYtModule (M6).
#
# Produces, under apps/mobile/android/app/src/main/assets/bin/:
#   python3.<abi>          Termux Python interpreter (ELF, bionic)
#   ffmpeg.<abi>           Termux ffmpeg (ELF, bionic)
#   ytdlp.zipapp           yt-dlp zipapp from the official release (arch independent)
#   ca-cert.pem            CA bundle, used as SSL_CERT_FILE (arch independent)
#   libs/<abi>/python3.X/  Python stdlib + site-packages (brotli, pycryptodomex)
#   libs/<abi>/*.so*       Shared libs in the actual DT_NEEDED closure
# and, under apps/mobile/android/app/src/main/jniLibs/<abi>/ (the exec()-able
# copies used at runtime):
#   libsincpython3.so      same ELF as python3.<abi>, RUNPATH -> app data
#   libsincffmpeg.so       same ELF as ffmpeg.<abi>, RUNPATH -> app data
#
# Why two copies: on Android 10+ (targetSdk>=29) an app may not exec() files
# in its own data dir (SELinux untrusted_app lost execute_no_trans on
# app_data_file), but MAY exec() files shipped in the APK native-lib dir
# (apk_data_file). So the two executables are packaged as native libs ending
# in ".so" (libsincpython3.so / libsincffmpeg.so) and the module runs them out
# of ApplicationInfo.nativeLibraryDir. The 250 MB lib/stdlib tree stays in
# app data because it is dlopen()ed / read, never execve()d. SincYtModule
# sets PYTHONHOME to the app-data abiDir, and the executables' DT_RUNPATH is
# rewritten to the *absolute* app-data lib dir (which bionic honours; it
# ignores LD_LIBRARY_PATH). NOTE: the absolute path hardcodes user 0, so the
# build is single-user-phone only (fine for the personal use this app serves).
#
# Sources: the Termux apt mirror (packages.termux.dev) + the yt-dlp GitHub
# release. Binaries are gitignored; run this script after cloning to enable
# YouTube/SoundCloud streaming and MP3 downloads. Without the assets the app
# degrades gracefully: SincYtModule.available() stays true (module linked)
# but resolve/download reject and the UI falls back to free/local providers.
#
# Size strategy: Termux's ffmpeg Depends pulls a ~290 MB flat lib tree
# (Vulkan/LLVM/OpenGL desktop paths included). Only the DT_NEEDED closure of
# the python interpreter + ffmpeg + python's extension modules is copied, so
# unrelated graphics libraries (libLLVM ~127 MB, X11, Wayland, cairo, ...)
# never reach the APK.
#
# Usage:
#   scripts/build-mobile-media-binaries.sh                  # arm64-v8a (release/main)
#   scripts/build-mobile-media-binaries.sh x86_64            # x86_64 (emulator/dev)
#   scripts/build-mobile-media-binaries.sh arm64-v8a x86_64  # both
#   YTDLP_VERSION=2026.08.19 scripts/build-mobile-media-binaries.sh
#
# Default is arm64-v8a only: it is ~53 MB of assets for BOTH ABIs (~100 MB),
# and virtually all devices/emulators run arm64 images today. Build x86_64
# explicitly for x86 emulators.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$REPO_DIR/apps/mobile/android/app/src/main/assets/bin"
TERMUX_REPO="https://packages.termux.dev/apt/termux-main"
YTDLP_VERSION="${YTDLP_VERSION:-2026.08.19}"
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"
ROOTS=(python ffmpeg ca-certificates python-brotli python-pycryptodomex)
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ABIS=("$@")
[[ ${#ABIS[@]} -eq 0 ]] && ABIS=(arm64-v8a)

termux_arch() {
  case "$1" in
    arm64-v8a) echo aarch64 ;;
    x86_64) echo x86_64 ;;
    *) echo "error: unsupported abi '$1' (use arm64-v8a or x86_64)" >&2; exit 1 ;;
  esac
}

PYENGINE="$WORK/engine.py"
cat > "$PYENGINE" <<'PYENGINE'
import os
import pathlib
import re
import struct
import subprocess
import sys

REPO = os.environ["TMX_REPO"]

# Bionic system libs present on every Android device; never bundle or warn.
SYSTEM_SONAMES = {"libc.so", "libdl.so", "libm.so", "liblog.so", "libandroid.so"}

# Shared libs preloaded by the generated sitecustomize.py at interpreter
# start-up (bionic ignores DT_RUNPATH for dlopen deps). Kept in the bundle
# even when no DT_NEEDED edge names them. KEEP IN SYNC with the
# sitecustomize.py heredoc written by build_abi().
PRELOAD_SONAMES = (
    "libandroid-posix-semaphore.so",
    "libandroid-support.so",
    "libbz2.so.1.0",
    "libcrypto.so.3",
    "libexpat.so.1",
    "libffi.so",
    "libgdbm.so",
    "libgdbm_compat.so",
    "liblzma.so.5",
    "libncursesw.so.6",
    "libpanelw.so.6",
    "libreadline.so.8",
    "libsqlite3.so",
    "libssl.so.3",
    "libz.so.1",
    "libzstd.so.1",
)


def parse_index(path):
    idx = {}
    for block in pathlib.Path(path).read_text().split("\n\n"):
        if not block.startswith("Package: "):
            continue
        pkg, fields, last = None, {}, None
        for line in block.splitlines():
            if line.startswith("Package: "):
                pkg = line[9:]
            elif pkg and line[:1] not in " \t" and ": " in line:
                k, v = line.split(": ", 1)
                fields[k] = v
                last = k
            elif pkg and line[:1] in " \t" and last:
                fields[last] += line
        if pkg:
            idx[pkg] = fields
    return idx


def mode_resolve(args):
    index_path, cache_dir, stage_dir, *roots = args
    cache = pathlib.Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    stage = pathlib.Path(stage_dir)
    stage.mkdir(parents=True, exist_ok=True)
    idx = parse_index(index_path)
    skip = {"python-pip", "termux-tools"}
    seen, queue, missing = set(), list(roots), []
    while queue:
        p = queue.pop()
        if p in seen or p in skip:
            continue
        if p not in idx:
            missing.append(p)
            continue
        seen.add(p)
        for alt in idx[p].get("Depends", "").split(","):
            name = re.sub(r"\(.*?\)", "", alt.split("|")[0]).strip()
            name = re.sub(r"\[.*?\]", "", name).strip()
            if name:
                queue.append(name)
    if missing:
        sys.stderr.write("warning: not in index: %s\n" % ", ".join(sorted(set(missing))))
    for p in sorted(seen):
        fn = idx[p].get("Filename")
        if not fn:
            continue
        deb = cache / pathlib.Path(fn).name
        if not deb.exists():
            subprocess.run(
                ["curl", "-fsSL", "--retry", "3", f"{REPO}/{fn}", "-o", str(deb)],
                check=True,
            )
        subprocess.run(["bsdtar", "-xf", str(deb), "-C", str(stage)], check=True)
        for da in stage.glob("data.tar.*"):
            subprocess.run(["tar", "-xf", str(da), "-C", str(stage)], check=True)
    print(f"resolved+extracted {len(seen)} packages")


def parse_needed(path):
    try:
        out = subprocess.run(
            ["readelf", "-d", str(path)],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except Exception:
        return []
    needed = []
    for line in out.splitlines():
        if "(NEEDED)" in line:
            m = re.search(r"Shared library: \[([^\]]+)\]", line)
            if m:
                needed.append(m.group(1))
    return needed


def mode_closure(args):
    tree = pathlib.Path(args[0])
    by_name = {}
    all_files = [p for p in tree.rglob("*") if p.is_file()]
    for p in all_files:
        by_name.setdefault(p.name, p)
    # Roots: the executables, plus python's dlopen'd extension modules (nested
    # .so files under the stdlib/site-packages tree). Top-level *.so files are
    # deliberately NOT roots: the flat tree also carries the Termux desktop /
    # graphics stack, and seeding the closure from it dragged libLLVM (127 MB)
    # and the X11/Wayland/cairo chain into the bundle even though neither the
    # interpreter nor ffmpeg DT_NEEDs any of it.
    roots = [tree / "python3", tree / "ffmpeg"]
    roots += [p for p in all_files if p.suffix == ".so" and p.parent != tree]
    needed, queue, picked = set(), list(roots), set()
    missing = set()
    # Pin the sitecustomize preload list: those files are opened by name at
    # runtime, so a missing DT_NEEDED edge must not drop them from the bundle.
    for preload in PRELOAD_SONAMES:
        cand = by_name.get(preload)
        if cand is not None:
            print(f"{cand.resolve()}\t{preload}")
            needed.add(preload)
            queue.append(cand.resolve())
    while queue:
        f = queue.pop()
        if f in picked or not f.exists():
            continue
        picked.add(f)
        for soname in parse_needed(f):
            if soname in needed:
                continue
            needed.add(soname)
            if soname in SYSTEM_SONAMES:
                continue
            cand = by_name.get(soname)
            if cand is not None:
                queue.append(cand.resolve())
                print(f"{cand.resolve()}\t{soname}")
            else:
                missing.add(soname)
    for m in sorted(missing):
        sys.stderr.write(f"warning: no file for DT_NEEDED soname {m}\n")
    sys.stderr.write(
        f"closure: {len(needed)} sonames, {len(picked)} ELF files scanned\n"
    )


if sys.argv[1] == "resolve":
    mode_resolve(sys.argv[2:])
else:
    mode_closure(sys.argv[2:])
PYENGINE

# Resolve + extract the full Depends closure of the root packages.
#   args: <index> <cache> <stage> <roots...>
resolve_and_extract() {
  TMX_REPO="$TERMUX_REPO" python3 "$PYENGINE" resolve "$1" "$2" "$3" "${@:4}"
}

# Compute the DT_NEEDED closure over a staged tree.
#   args: <tree>  -> stdout lines "realpath<TAB>soname"
needed_closure() {
  TMX_REPO="$TERMUX_REPO" python3 "$PYENGINE" closure "$1"
}

build_abi() {
  local abi="$1" arch
  arch="$(termux_arch "$abi")"
  local stage="$WORK/stage-$arch" cache="$WORK/cache-$arch" index="$WORK/Packages-$arch"
  echo "==> [$abi] fetching package index ($arch)"
  curl -fsSL "$TERMUX_REPO/dists/stable/main/binary-$arch/Packages" -o "$index"
  echo "==> [$abi] resolving + extracting Termux dependency closure"
  resolve_and_extract "$index" "$cache" "$stage" "${ROOTS[@]}"

  local prefix="$stage/data/data/com.termux/files/usr"
  [[ -d "$prefix" ]] || { echo "error: unexpected deb layout in $stage" >&2; exit 1; }

  local pybin ffbin
  pybin="$(find "$prefix/bin" -maxdepth 1 -name 'python3*' -type f | while read -r f; do
    [[ "$(head -c 4 "$f")" == $'\x7fELF' ]] && { echo "$f"; break; }
  done)"
  ffbin="$prefix/bin/ffmpeg"
  [[ -n "$pybin" && -f "$ffbin" ]] || {
    echo "error: python3/ffmpeg binary missing under $prefix/bin" >&2
    exit 1
  }

  # One flat tree so every lib is findable under a single name everywhere.
  local flat="$WORK/flat-$arch"
  rm -rf "$flat"
  mkdir -p "$flat"
  cp -aL "$prefix/lib/." "$flat/" 2>/dev/null || true
  cp -L "$pybin" "$flat/python3"
  cp -L "$ffbin" "$flat/ffmpeg"

  echo "==> [$abi] computing DT_NEEDED closure (prunes Vulkan/LLVM/OpenGL fat)"
  local needed="$WORK/needed-$arch.txt"
  needed_closure "$flat" > "$needed"

  local libs="$ASSET_DIR/libs/$abi"
  rm -rf "$libs"
  mkdir -p "$libs"
  cp -L "$flat/python3" "$ASSET_DIR/python3.$abi"
  cp -L "$flat/ffmpeg" "$ASSET_DIR/ffmpeg.$abi"

  local pylib pylibname
  pylib="$(find "$prefix/lib" -maxdepth 1 -type d -name 'python3.*' | head -n1)"
  [[ -n "$pylib" ]] || { echo "error: python stdlib dir not found" >&2; exit 1; }
  pylibname="$(basename "$pylib")"
  mkdir -p "$libs/$pylibname"
  (cd "$pylib" && tar cf - \
      --exclude=test --exclude=tests --exclude=idlelib --exclude=tkinter \
      --exclude=turtledemo --exclude=lib2to3 --exclude=__pycache__ \
      --exclude=pydoc_data --exclude=wsgiref \
      --exclude=site-packages/Cryptodome/SelfTest .) \
    | (cd "$libs/$pylibname" && tar xf -)

  # Preloads the bundled libs that python's dlopen'd extension modules link
  # against (bionic ignores DT_RUNPATH for dlopen deps, so they must already be
  # loaded by name when _ssl/_brotli/etc. are imported).
  cat > "$libs/$pylibname/site-packages/sitecustomize.py" <<'PY'
import ctypes
import os

_LIBRARY_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "lib")
)

for _name in (
    "libandroid-posix-semaphore.so",
    "libandroid-support.so",
    "libbz2.so.1.0",
    "libcrypto.so.3",
    "libexpat.so.1",
    "libffi.so",
    "libgdbm.so",
    "libgdbm_compat.so",
    "liblzma.so.5",
    "libncursesw.so.6",
    "libpanelw.so.6",
    "libreadline.so.8",
    "libsqlite3.so",
    "libssl.so.3",
    "libz.so.1",
    "libzstd.so.1",
):
    try:
        ctypes.CDLL(os.path.join(_LIBRARY_DIR, _name))
    except OSError:
        pass
PY

  # The Android asset-merge silently drops asset directories whose names begin
  # with an underscore (zipfile/_path, _pyrepl, __phello__, compression/_common)
  # — fatal for Python, which does `from zipfile._path import` on start-up. The
  # dropped dirs are therefore packed into a single-file asset (which survives
  # the merge) and inflated by SincYtModule into the stdlib tree at first run.
  local extras="$ASSET_DIR/libs/$abi/stdlib_extras.zip"
  local dlist d
  dlist="$(cd "$libs" && find python3.14 -mindepth 1 -type d -name '_*' ! -name '__pycache__')"
  if [[ -n "$dlist" ]]; then
    # The Android asset-merge drops underscore dirs, so if these exist the zip
    # is mandatory; a missing bsdtar must fail loudly, never silently ship a
    # broken interpreter.
    command -v bsdtar >/dev/null 2>&1 || {
      echo "error: bsdtar (libarchive-tools) is required to pack underscore dirs into stdlib_extras.zip" >&2
      exit 1
    }
    (cd "$libs" && bsdtar -cf "$extras" --format zip $dlist)
    while IFS= read -r d; do rm -rf "$libs/$d"; done <<<"$dlist"
    echo "==> [$abi] packed underscore dirs into stdlib_extras.zip"
  fi

  local count=0 real name
  while IFS=$'\t' read -r real name; do
    [[ -n "$name" ]] || continue
    if [[ -n "$real" && "$real" != "MISSING" && -f "$real" ]]; then
      cp -L "$real" "$libs/$name"
      count=$((count + 1))
    fi
  done < "$needed"
  echo "==> [$abi] copied $count shared libraries"
  [[ "$count" -gt 0 ]] || { echo "error: no shared libs copied for $abi" >&2; exit 1; }
  # Regression guard: the closure must never re-adopt the LLVM/graphics fat.
  if compgen -G "$libs/libLLVM*" > /dev/null; then
    echo "error: libLLVM leaked into the $abi bundle (closure roots regressed?)" >&2
    exit 1
  fi
  echo "    bundle libs: $(du -sm "$libs" | cut -f1) MB"

  echo "==> [$abi] rewriting DT_RUNPATH to \$ORIGIN-relative (bionic ignores LD_LIBRARY_PATH)"
  patch_runpaths "$ASSET_DIR/python3.$abi" '$ORIGIN/lib'
  patch_runpaths "$ASSET_DIR/ffmpeg.$abi" '$ORIGIN/lib'
  # The runtime executables are shipped as APK native libs (libsinc*.so) and
  # exec()ed from nativeLibraryDir far away from the app-data lib tree, so
  # their RUNPATH is the *absolute* app-data lib dir instead of $ORIGIN.
  local jnilibs="$REPO_DIR/apps/mobile/android/app/src/main/jniLibs/$abi"
  mkdir -p "$jnilibs"
  cp -L "$flat/python3" "$jnilibs/libsincpython3.so"
  cp -L "$flat/ffmpeg" "$jnilibs/libsincffmpeg.so"
  patch_runpaths "$jnilibs/libsincpython3.so" '/data/user/0/com.sinc.app/files/sinc_bin/yt/lib'
  patch_runpaths "$jnilibs/libsincffmpeg.so" '/data/user/0/com.sinc.app/files/sinc_bin/yt/lib'
  # Each ELF's RUNPATH becomes $ORIGIN + one '/..' per directory level between
  # it and the flat libDir(). lib-dynload/_ssl.so sits at lib/python3.14/lib-dynload/
  # (two levels) -> $ORIGIN/../.. ; a shared lib flat in libDir() -> $ORIGIN.
  local so target rel depth n
  while IFS= read -r -d '' so; do
    rel="${so#"$libs/"}"
    depth="${rel//[^\/]/}"
    n="${#depth}"
    target='$ORIGIN'
    while (( n-- > 0 )); do target+='/..'; done
    patch_runpaths "$so" "$target"
  done < <(find "$libs" -type f -name '*.so*' -print0)
  local so bad=0
  for so in "$ASSET_DIR/python3.$abi" "$ASSET_DIR/ffmpeg.$abi"; do
    if [[ "$(readelf -d "$so" 2>/dev/null)" == *"/data/data/com.termux/files/usr/lib"* ]]; then
      echo "  residual RUNPATH: $so" >&2
      bad=1
    fi
  done
  while IFS= read -r -d '' so; do
    if [[ "$(readelf -d "$so" 2>/dev/null)" == *"/data/data/com.termux/files/usr/lib"* ]]; then
      echo "  residual RUNPATH: $so" >&2
      bad=1
    fi
  done < <(find "$libs" -type f -name '*.so*' -print0)
  if [[ "$bad" == 1 ]]; then
    echo "error: termux-absolute RUNPATH still present in $abi bundle" >&2
    exit 1
  fi
  return 0
}

# Overwrites every occurrence of the hardcoded Termux lib path in an ELF's
# .dynstr with a shorter $ORIGIN-relative RUNPATH (padding with NULs). The
# Android linker honours DT_RUNPATH (incl. $ORIGIN) but ignores
# LD_LIBRARY_PATH, so this is what makes the bundled libraries resolvable.
patch_runpaths() {
  local file="$1" new="$2"
  python3 - "$file" "$new" <<'PY'
import sys

f, new = sys.argv[1], sys.argv[2].encode()
old = b"/data/data/com.termux/files/usr/lib"
data = bytearray(open(f, "rb").read())
hits = 0
pos = 0
while True:
    i = data.find(old, pos)
    if i < 0:
        break
    if len(new) <= len(old):
        data[i : i + len(new)] = new
        data[i + len(new) : i + len(old)] = b"\x00" * (len(old) - len(new))
        hits += 1
    pos = i + len(old)
if hits:
    open(f, "wb").write(bytes(data))
    print(f"    patched {hits} RUNPATH entries in {f}")
PY
}

build_common() {
  mkdir -p "$ASSET_DIR"
  echo "==> fetching yt-dlp ${YTDLP_VERSION} zipapp"
  curl -fsSL --retry 3 "$YTDLP_URL" -o "$ASSET_DIR/ytdlp.zipapp"
  python3 - "$ASSET_DIR/ytdlp.zipapp" <<'PY'
import sys, zipfile
p = sys.argv[1]
if not zipfile.is_zipfile(p):
    sys.exit("error: ytdlp.zipapp is not a zip archive")
print("ytdlp.zipapp ok:", len(zipfile.ZipFile(p).namelist()), "entries")
PY

  echo "==> fetching CA certificates"
  local ca="$WORK/ca"
  rm -rf "$ca"
  mkdir -p "$ca"
  resolve_and_extract "$WORK/Packages-aarch64" "$WORK/cache-ca" "$ca" ca-certificates >/dev/null
  local cert
  cert="$(find "$ca" -name cert.pem -type f -print -quit || true)"
  [[ -z "$cert" ]] && cert="$(find "$ca" -name '*.pem' -type f | head -n1 || true)"
  if [[ -n "$cert" ]]; then
    cp -L "$cert" "$ASSET_DIR/ca-cert.pem"
    echo "ca-cert.pem ok ($(wc -c < "$cert") bytes)"
  else
    echo "warning: CA bundle not found in ca-certificates package" >&2
  fi
}

for abi in "${ABIS[@]}"; do build_abi "$abi"; done
curl -fsSL "$TERMUX_REPO/dists/stable/main/binary-aarch64/Packages" -o "$WORK/Packages-aarch64"
build_common

echo "==> done."
find "$ASSET_DIR" -type f | sed "s|$ASSET_DIR/|  |" | sort
du -sh "$ASSET_DIR"