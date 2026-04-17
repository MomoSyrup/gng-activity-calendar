#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/gng-activity-calendar}"
BRANCH="${BRANCH:-master}"
PROCESS_NAME="${PROCESS_NAME:-gng-activity-calendar}"
APP_PORT="${APP_PORT:-}"
RELEASE_DIR="${RELEASE_DIR:-}"
RELEASE_TGZ="${RELEASE_TGZ:-}"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v npm >/dev/null 2>&1 || fail "npm is required on the server"
command -v pm2 >/dev/null 2>&1 || fail "pm2 is required on the server"
command -v curl >/dev/null 2>&1 || fail "curl is required on the server"
command -v rsync >/dev/null 2>&1 || fail "rsync is required on the server"

mkdir -p "${APP_DIR}"

if [[ -n "${RELEASE_TGZ}" ]]; then
  [[ -f "${RELEASE_TGZ}" ]] || fail "Release archive not found: ${RELEASE_TGZ}"
  : "${RELEASE_DIR:=/tmp/gng-activity-calendar-release}"
  rm -rf "${RELEASE_DIR}"
  mkdir -p "${RELEASE_DIR}"
  log "Extracting release archive ${RELEASE_TGZ}"
  tar -xzf "${RELEASE_TGZ}" -C "${RELEASE_DIR}"
fi

if [[ -n "${RELEASE_DIR}" ]]; then
  [[ -d "${RELEASE_DIR}" ]] || fail "Release directory not found: ${RELEASE_DIR}"
  log "Syncing release bundle from ${RELEASE_DIR} to ${APP_DIR}"
  rsync -a --delete \
    --exclude '.env' \
    --exclude 'data/' \
    --exclude 'node_modules/' \
    --exclude '.git/' \
    "${RELEASE_DIR}/" "${APP_DIR}/"
else
  command -v git >/dev/null 2>&1 || fail "git is required on the server when RELEASE_DIR is not provided"
  [[ -d "${APP_DIR}/.git" ]] || fail "No git repository found at ${APP_DIR}"

  cd "${APP_DIR}"
  log "Fetching latest code from origin/${BRANCH}"
  git fetch origin "${BRANCH}"
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

cd "${APP_DIR}"

mkdir -p data/uploads public/generated

log "Installing production dependencies"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --production
fi

if [[ -z "${APP_PORT}" ]] && [[ -f .env ]]; then
  APP_PORT="$(grep -E '^PORT=' .env | tail -n 1 | cut -d= -f2- || true)"
fi
: "${APP_PORT:=3000}"

if [[ -f ecosystem.config.cjs ]]; then
  log "Applying PM2 ecosystem config"
  pm2 startOrRestart ecosystem.config.cjs --env production --only "${PROCESS_NAME}"
elif pm2 describe "${PROCESS_NAME}" >/dev/null 2>&1; then
  log "Restarting existing PM2 process ${PROCESS_NAME}"
  pm2 restart "${PROCESS_NAME}" --update-env
else
  log "Starting PM2 process ${PROCESS_NAME}"
  pm2 start server.js --name "${PROCESS_NAME}"
fi

pm2 save

log "Running health check on http://127.0.0.1:${APP_PORT}/api/calendar"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent "http://127.0.0.1:${APP_PORT}/api/calendar" >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 10 ]]; then
    fail "Health check failed after ${attempt} attempts"
  fi
  sleep 2
done

CURRENT_REV="$(git rev-parse --short HEAD 2>/dev/null || true)"
if [[ -n "${CURRENT_REV}" ]]; then
  log "Deployment finished successfully at revision ${CURRENT_REV}"
else
  log "Deployment finished successfully"
fi
