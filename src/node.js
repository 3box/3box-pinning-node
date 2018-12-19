#!/usr/bin/env node

require('dotenv').config()
const Pinning = require('./pinning')
const RedisCache = require('./cache')
const CacheService = require('./cacheService')

// TODO move to to env configs
const ADDRESS_SERVER_URL = 'https://beta.3box.io/address-server'
const ORBITDB_PATH = '/opt/orbitdb'
//const IPFS_PATH = '/opt/ipfs'
const IPFS_PATH = null
const REDIS_PATH = 'profilecache.h9luwi.0001.usw2.cache.amazonaws.com'

const DAYS15 = 60 * 60 * 24 * 15 // 15 day ttl

async function start () {
  const cache = new RedisCache({ host: REDIS_PATH }, DAYS15)
  const pinning = new Pinning(cache, IPFS_PATH, ORBITDB_PATH)
  const cacheService = new CacheService(cache, pinning, ADDRESS_SERVER_URL)
  await pinning.start()
  cacheService.start()
}

start()
