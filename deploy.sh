#!/usr/bin/env bash
if [[ "${CIRCLE_BRANCH}" == "develop" ]]; then
  git pull origin develop
  npm i
  cp .env.development .env
  pm2 restart server
fi
if [ "${CIRCLE_BRANCH}" == "master" ]; then
  git pull origin master
  npm i
  cp .env.production .env
  pm2 restart server
fi
