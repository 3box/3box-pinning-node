#!/usr/bin/env bash

if [[ "$CIRCLE_BRANCH" == "feat/automate-deployment" ]]; then
  git pull origin develop
  npm i -g pm2
  npm i
  cp .env.development.example .env.development
  pm2 restart node
fi
if [ "$CIRCLE_BRANCH" == "master" ]; then
  git pull origin master
  npm i -g pm2
  npm i
  cp .env.production.example .env.production
  pm2 restart node
fi
