#!/usr/bin/env bash

git pull origin master
pm2 restart server
