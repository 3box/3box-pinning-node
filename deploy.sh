#!/usr/bin/env bash
cd ~/3box-pinning-server
if [[ "$CIRCLE_BRANCH" == "develop" ]]; then
  git stash
  git checkout -f develop
  git pull origin develop
  npm i -g pm2
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
  npm i -g pm2
  npm i
  if [ ! -f .env.production ]; then
    cp .env.production.example .env.production
  fi
  pm2 restart node
fi
