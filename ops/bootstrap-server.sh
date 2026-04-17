#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-gng}"
APP_DIR="${APP_DIR:-/opt/gng-activity-calendar}"
REPO_URL="${REPO_URL:-https://github.com/MomoSyrup/gng-activity-calendar.git}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log() {
  printf '[bootstrap] %s\n' "$*"
}

fail() {
  printf '[bootstrap] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Run this script as root"
fi

run_as_app() {
  runuser -u "${APP_USER}" -- "$@"
}

export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update
apt-get install -y ca-certificates curl git nginx build-essential rsync

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing pm2 globally"
  npm install -g pm2
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  log "Creating application user ${APP_USER}"
  adduser --disabled-password --gecos "" "${APP_USER}"
fi

log "Preparing application directory ${APP_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  log "Cloning repository into ${APP_DIR}"
  run_as_app git clone "${REPO_URL}" "${APP_DIR}"
else
  log "Repository already exists at ${APP_DIR}"
fi

run_as_app mkdir -p "${APP_DIR}/data/uploads" "${APP_DIR}/public/generated"

cat <<EOF

[bootstrap] Base setup finished.

Next steps:
1. Copy your production .env to:
   ${APP_DIR}/.env

2. Ensure the server can pull the repository:
   - Public repo: no extra step
   - Private repo: add a read-only deploy key or PAT

3. Install Chromium if you need SeaTalk image rendering, then set:
   PUPPETEER_EXECUTABLE_PATH

4. As ${APP_USER}, finish first-time startup:
   cd ${APP_DIR}
   npm ci --omit=dev
   pm2 start ecosystem.config.cjs --env production
   pm2 save

5. Enable PM2 startup:
   pm2 startup

6. Install the nginx template from:
   ops/nginx/gng-activity-calendar.conf

EOF
