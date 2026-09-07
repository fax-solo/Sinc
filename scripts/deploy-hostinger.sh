#!/usr/bin/env bash
#
# Hostinger KVM VPS setup + deploy for the Sinc API.
#
# Two roles:
#   1) ONE-TIME server provisioning (run ON the VPS as root):
#        bash scripts/deploy-hostinger.sh setup
#   2) Build & deploy the app (run from your machine, or on the VPS):
#        bash scripts/deploy-hostinger.sh deploy
#
# Pricing note: Hostinger KVM promo prices renew at a higher rate, and there is
# no free tier. KVM 1 (1 vCPU/4GB) runs Sinc; KVM 2 (2 vCPU/8GB) is recommended
# for yt-dlp/ffmpeg downloads. The database stays on Neon (free) so no Postgres
# container is needed here.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="docker-compose.hostinger.yml"
CONTAINER="sinc-api"
HEALTH_URL="http://127.0.0.1:3000/health"

#############################
# One-time provisioning (run on the VPS)
#############################
setup_vps() {
  echo "==> Updating system..."
  apt-get update -y && apt-get upgrade -y

  # Install Docker Engine + Compose plugin (official repo).
  if ! command -v docker >/dev/null 2>&1; then
    echo "==> Installing Docker..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
  fi

  # UFW firewall: only SSH, HTTP, HTTPS and the API port.
  echo "==> Configuring firewall..."
  if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3000/tcp
    ufw --force enable
  fi

  echo "==> Done. Next: clone the repo, create .env, then run:"
  echo "    bash scripts/deploy-hostinger.sh deploy"
}

#############################
# HTTPS reverse proxy (nginx + Let's Encrypt). Run on the VPS.
#   bash scripts/deploy-hostinger.sh proxy api.example.com
#############################
proxy() {
  local domain="${1:-}"
  if [ -z "$domain" ]; then
    echo "Usage: $0 proxy <your.domain>" >&2
    echo "Point an A/AAAA record for <your.domain> at this VPS IP first." >&2
    exit 1
  fi

  local site_src="$ROOT_DIR/deploy/nginx/sinc.conf"
  local site_dst="/etc/nginx/sites-available/sinc"

  echo "==> Installing nginx + certbot..."
  apt-get install -y nginx certbot python3-certbot-nginx

  echo "==> Writing nginx site (domain: $domain)..."
  mkdir -p /var/www/certbot
  sed "s|SERVER_NAME|$domain|g" "$site_src" > "$site_dst"

  # Enable site, keep nginx default-conf disabled on 443 to avoid conflict.
  ln -sf "$site_dst" /etc/nginx/sites-enabled/sinc
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  echo "==> Issuing Let's Encrypt certificate (webroot)..."
  certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos --register-unsafely-without-email \
    -d "$domain" || true

  # Patch cert paths into the site (already templated to fullchain/privkey),
  # then reload to pick up the certs.
  nginx -t && systemctl reload nginx

  echo "==> Setting up auto-renewal for the cert..."
  if ! grep -q "certbot renew --webroot" /etc/cron.d/certbot 2>/dev/null; then
    echo "17 3,15 * * * root certbot renew --webroot -w /var/www/certbot --quiet --deploy-hook 'systemctl reload nginx'" > /etc/cron.d/certbot
    chmod 644 /etc/cron.d/certbot
  fi

  echo "==> Done. Sinc API is now served at https://$domain"
  echo "    (API container must be running on 3000 first: bash scripts/deploy-hostinger.sh deploy)"
}

#############################
# Build + deploy (run on the VPS from the repo checkout)
#############################
deploy() {
  if [ ! -f "$ROOT_DIR/$COMPOSE_FILE" ]; then
    echo "ERROR: $COMPOSE_FILE not found. Run from the repo checkout." >&2
    exit 1
  fi

  if [ ! -f "$ROOT_DIR/.env" ]; then
    echo "ERROR: .env missing in $ROOT_DIR. See the .env template below." >&2
    cat <<'EOF'

Create .env with the Sinc secrets (same as HF deploy), for example:
  NODE_ENV=production
  DATABASE_URL=postgresql://neondb_owner:...@...pooler...neon.tech/neondb?sslmode=require
  JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...multiline RSA key...
-----END PRIVATE KEY-----"
  JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----"
  ADMIN_BOOTSTRAP_EMAIL=you@example.com
  # Optional:
  CORS_ORIGIN=*
  MIN_APP_VERSION=0.0.0
EOF
    exit 1
  fi

  echo "==> Building image & starting containers..."
  docker compose -f "$ROOT_DIR/$COMPOSE_FILE" up -d --build

  echo "==> Waiting for /health..."
  for i in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "==> Healthy after ${i}x attempts."
      docker ps
      echo "==> API is live. Logs: docker logs -f $CONTAINER"
      exit 0
    fi
    sleep 2
  done

  echo "ERROR: /health not up in time. Check logs: docker logs $CONTAINER" >&2
  exit 1
}

case "${1:-}" in
  setup)   setup_vps ;;
  deploy)  deploy ;;
  proxy)   proxy "${2:-}" ;;
  *)
    echo "Usage: $0 {setup|deploy|proxy <domain>}" >&2
    echo "  setup          - one-time VPS provisioning (Docker, firewall) - run as root on the VPS" >&2
    echo "  deploy         - build & start the Sinc API (run from repo checkout)" >&2
    echo "  proxy <domain> - nginx + Let's Encrypt HTTPS on <domain>, proxying to :3000" >&2
    exit 1
    ;;
esac
