#!/usr/bin/env bash
cd ~/3box-pinning-server
if [[ "$CIRCLE_BRANCH" == "develop" ]]; then
  git stash
  git checkout -f develop
  git pull origin develop
  git reset --hard origin/develop
  PM2_INSTALLED=$(npm list -g | grep pm2 | wc -l)
  if [ "$PM2_INSTALLED" -eq 0 ]; then
    npm i -g pm2
    pm2 update
  fi
  npm i
  if [ ! -f .env.development ]; then
    cp .env.development.example .env.development
  fi
  pm2 restart node
fi
if [ "$CIRCLE_BRANCH" == "master" ]; then
  git stash
  git checkout -f master
  git pull origin master
  git reset --hard origin/master
  PM2_INSTALLED=$(npm list -g | grep pm2 | wc -l)
  if [ "$PM2_INSTALLED" -eq 0 ]; then
    npm i -g pm2
    pm2 update
  fi
  npm i
  if [ ! -f .env.production ]; then
    cp .env.production.example .env.production
  fi
  pm2 restart node
fi
