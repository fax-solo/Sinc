#!/usr/bin/env bash
# Generates the release keystore used to sign every Sinc APK release and prints
# the exact GitHub secret values to add to the repository.
#
# Run it ONCE (any machine with a JDK works) and store the printed secrets
# somewhere safe. Every release must be signed with the SAME key, otherwise the
# new APK cannot update over an existing install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_KEYSTORE="$SCRIPT_DIR/../apps/mobile/android/app/release.keystore"
KEYSTORE="${1:-$DEFAULT_KEYSTORE}"

if [ -e "$KEYSTORE" ]; then
  echo "Keystore already exists at $KEYSTORE" >&2
  echo "Refusing to overwrite it. If you lost the passwords you must create a NEW key;" >&2
  echo "existing installs will then need a manual reinstall instead of an update." >&2
  exit 1
fi

KEYSTORE_DIR="$(dirname "$KEYSTORE")"
if [ ! -d "$KEYSTORE_DIR" ]; then
  mkdir -p "$KEYSTORE_DIR"
fi

# PKCS12 keystores only support one password for the store and the private key.
# Keep a single password: passing a different -keypass is silently ignored by
# keytool and would make the release build fail at signing time.
password="$(openssl rand -hex 16)"
alias="sinc"

keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -storetype PKCS12 \
  -alias "$alias" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$password" \
  -keypass "$password" \
  -dname "CN=Sinc, OU=Sinc, O=Sinc, L=Internet, ST=Internet, C=US"

base64="$(base64 "$KEYSTORE" | tr -d '\n')"

cat <<EOF

=== Add these three secrets to GitHub (Settings > Secrets and variables > Actions) ===
SINC_KEYSTORE_BASE64=$base64
SINC_KEYSTORE_PASSWORD=$password
SINC_KEY_ALIAS=$alias

Keystore saved to: $KEYSTORE
Keep the file and passwords safe (e.g. in a password manager). Once the secrets
are in GitHub you may delete $KEYSTORE; only the secrets matter for CI.
EOF