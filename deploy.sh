#!/bin/bash
# ============================================================================
# Public Form Logger — Production deployment (VPS)
# ============================================================================
# - Pulls the latest `main`
# - Rebuilds the api image
# - Recreates `public-form-logger-api` and `public-form-logger-postgres`
# - Runs `prisma migrate deploy` (idempotent)
# - Reloads ems-nginx so the /logger location picks up any conf changes
#
# Pre-requisites on the VPS:
#   - /opt/public-form-logger/ exists with .env.vps (NOT committed)
#   - Network `ems-network` exists (created by ems-attendee stack)
#   - ems-nginx has a `location /logger/` block pointing to public-form-logger-api
# ============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

DEPLOY_DIR="/opt/public-form-logger"
REPO="https://github.com/Rabiegha/Public-Form-Logger.git"
BRANCH="main"

echo -e "${GREEN}=== Public Form Logger deploy ===${NC}"

# 1. Ensure dir + checkout
sudo mkdir -p "$DEPLOY_DIR"
sudo chown -R "$USER":"$USER" "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

if [ ! -d app/.git ]; then
  echo -e "${YELLOW}[1/5] Cloning repo...${NC}"
  git clone -b "$BRANCH" "$REPO" app
else
  echo -e "${YELLOW}[1/5] Updating repo (branch: $BRANCH)...${NC}"
  cd app
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
  cd ..
fi

# 2. Validate .env.vps
if [ ! -f .env.vps ]; then
  echo -e "${RED}ERROR: .env.vps missing in $DEPLOY_DIR${NC}"
  echo "Copy app/.env.vps.example to $DEPLOY_DIR/.env.vps and fill secrets."
  exit 1
fi
ln -sf "$DEPLOY_DIR/.env.vps" "$DEPLOY_DIR/app/.env.vps"

cd "$DEPLOY_DIR/app"

# 3. Ensure network exists
if ! docker network inspect ems-network >/dev/null 2>&1; then
  echo -e "${RED}ERROR: docker network 'ems-network' not found.${NC}"
  echo "The Attendee stack must be running before deploying the Logger."
  exit 1
fi

# 4. Build + recreate containers (volumes preserved)
echo -e "${YELLOW}[2/5] Building image...${NC}"
docker compose -f docker-compose.prod.yml build api

echo -e "${YELLOW}[3/5] Restarting services (volumes preserved)...${NC}"
docker compose -f docker-compose.prod.yml up -d postgres api

echo "Waiting for api to come up..."
sleep 8

# 5. Run migrations (Dockerfile CMD also runs them, but explicit call is safer)
echo -e "${YELLOW}[4/5] Running Prisma migrations...${NC}"
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy || true

# 6. Reload ems-nginx (the /logger location lives in the Attendee nginx config)
echo -e "${YELLOW}[5/5] Reloading ems-nginx...${NC}"
if docker ps --filter "name=ems-nginx" --format "{{.Names}}" | grep -q ems-nginx; then
  docker exec ems-nginx nginx -t && docker exec ems-nginx nginx -s reload
  echo -e "${GREEN}[OK] nginx reloaded${NC}"
else
  echo -e "${YELLOW}[WARN] ems-nginx not running, skipping reload${NC}"
fi

echo ""
echo -e "${GREEN}=== Deployment complete ===${NC}"
docker ps --filter "name=public-form-logger" --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "URLs:"
echo "  Admin:   https://api.attendee.fr/logger/admin"
echo "  Health:  https://api.attendee.fr/logger/health"
echo "  Ingest:  https://api.attendee.fr/logger/v1/public-form-logs"
