#!/usr/bin/env node

const argv = require('yargs').argv
const path = require('path')
const Pinning = require('./pinning')
const { ipfsRepo } = require('./s3')
const { RedisCache, NullCache } = require('./cache')
const CacheService = require('./cacheService')
const Util = require('./util')
const Analytics = require('./analytics')

const env = process.env.NODE_ENV || 'development'
require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${env}`) })

const ADDRESS_SERVER_URL = process.env.ADDRESS_SERVER_URL
const ORBITDB_PATH = process.env.ORBITDB_PATH
const IPFS_PATH = process.env.IPFS_PATH
const REDIS_PATH = process.env.REDIS_PATH
const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY
const ANALYTICS_ACTIVE = process.env.ANALYTICS_ACTIVE || true
const ORBIT_REDIS_PATH = process.env.ORBIT_REDIS_PATH

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

const DAYS15 = 60 * 60 * 24 * 15 // 15 day ttl
const runCacheService = argv.runCacheService !== 'false'

const analyticsClient = new Analytics(SEGMENT_WRITE_KEY, ANALYTICS_ACTIVE)
const util = new Util(ORBITDB_PATH, IPFS_PATH)
const orbitCacheRedisOpts = ORBIT_REDIS_PATH ? { host: ORBIT_REDIS_PATH } : null

function sendInfraMetrics () {
  analyticsClient.trackInfraMetrics(util.getTotalOrbitStores(), util.getOrbitDBDiskUsage, util.getIPFSDiskUsage())
}

function prepareIPFSConfig () {
  if (AWS_BUCKET_NAME) {
    if (!IPFS_PATH || !AWS_BUCKET_NAME || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error('Invalid IPFS + s3 configuration')
    }

    const repo = ipfsRepo({
      path: IPFS_PATH,
      bucket: AWS_BUCKET_NAME,
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    })
    return { repo }
  } else if (IPFS_PATH) {
    return { repo: IPFS_PATH }
  }

  return {}
}

async function start (runCacheService) {
  const cache = REDIS_PATH && runCacheService ? new RedisCache({ host: REDIS_PATH }, DAYS15) : new NullCache()
  const ipfsConfig = prepareIPFSConfig()
  const pinning = new Pinning(cache, ipfsConfig, ORBITDB_PATH, analyticsClient, orbitCacheRedisOpts)
  await pinning.start()
  setInterval(sendInfraMetrics, 1800000)
  if (runCacheService) {
    const cacheService = new CacheService(cache, pinning, ADDRESS_SERVER_URL)
    cacheService.start()
  }
}

start(runCacheService)
