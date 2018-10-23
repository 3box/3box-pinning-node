#!/usr/bin/env bash

git pull origin master
cp .env.default .env
pm2 restart server
