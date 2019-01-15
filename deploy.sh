#!/usr/bin/env bash
if [[ "${CIRCLE_BRANCH}" == "develop" ]]; then
  git pull origin develop
  npm i -g pm2
  npm i
  pm2 restart server
fi
if [ "${CIRCLE_BRANCH}" == "master" ]; then
  git pull origin master
  npm i -g pm2
  npm i
  pm2 restart server
fi
