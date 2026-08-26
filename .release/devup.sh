#!/bin/bash
# Helper to start dev containers and log output to a project file for diagnostics.
cd /home/devuser/workspace/ai-engkit
unset ADMIN_PASSWORD
LOG=/home/devuser/workspace/ai-engkit/.release/devup.log
mkdir -p /home/devuser/workspace/ai-engkit/.release
: > "$LOG"
echo "=== docker compose ps (before) ===" >> "$LOG"
docker compose -p dev -f docker-compose.dev.yml ps >> "$LOG" 2>&1
echo "=== up -d ===" >> "$LOG"
docker compose -p dev -f docker-compose.dev.yml up -d >> "$LOG" 2>&1
echo "EXIT:$?" >> "$LOG"
echo "=== docker compose ps (after) ===" >> "$LOG"
docker compose -p dev -f docker-compose.dev.yml ps >> "$LOG" 2>&1
echo "=== docker ps dev containers ===" >> "$LOG"
docker ps -a --format '{{.Names}}|{{.Status}}' | grep -E 'ai-engkit' >> "$LOG" 2>&1