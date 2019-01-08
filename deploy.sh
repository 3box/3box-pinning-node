#!/usr/bin/env bash

git pull origin master
cp .env.production .env
pm2 restart server
