#!/usr/bin/env node

const argv = require('yargs').argv
const path = require('path')
const Pinning = require('./pinning')
const { RedisCache, NullCache } = require('./cache')
const CacheService = require('./cacheService')

const env = process.env.NODE_ENV || 'development'
require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${env}`) })

const ADDRESS_SERVER_URL = process.env.ADDRESS_SERVER_URL
const ORBITDB_PATH = process.env.ORBITDB_PATH
const IPFS_PATH = process.env.IPFS_PATH
const REDIS_PATH = process.env.REDIS_PATH

const DAYS15 = 60 * 60 * 24 * 15 // 15 day ttl
const runCacheService = argv.runCacheService !== 'false'

async function start (runCacheService) {
  const cache = REDIS_PATH && runCacheService ? new RedisCache({ host: REDIS_PATH }, DAYS15) : new NullCache()
  const pinning = new Pinning(cache, IPFS_PATH, ORBITDB_PATH)
  await pinning.start()
  if (runCacheService) {
    const cacheService = new CacheService(cache, pinning, ADDRESS_SERVER_URL)
    cacheService.start()
  }
}

start(runCacheService)
