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

store_password="$(openssl rand -hex 16)"
key_password="$(openssl rand -hex 16)"
alias="sinc"

keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -alias "$alias" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$store_password" \
  -keypass "$key_password" \
  -dname "CN=Sinc, OU=Sinc, O=Sinc, L=Internet, ST=Internet, C=US"

base64="$(base64 "$KEYSTORE" | tr -d '\n')"

cat <<EOF

=== Add these four secrets to GitHub (Settings > Secrets and variables > Actions) ===
SINC_KEYSTORE_BASE64=$base64
SINC_KEYSTORE_PASSWORD=$store_password
SINC_KEY_ALIAS=$alias
SINC_KEY_PASSWORD=$key_password

Keystore saved to: $KEYSTORE
Keep the file and passwords safe (e.g. in a password manager). Once the secrets
are in GitHub you may delete $KEYSTORE; only the secrets matter for CI.
EOF