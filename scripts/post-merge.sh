#!/bin/bash
set -e
npm install
echo "" | npm run db:push -- --force 2>&1 || npm run db:push -- --force
