#!/usr/bin/env node

require('dotenv').config()
const Pinning = require('./pinning')
const RedisCache = require('./cache')
const CacheService = require('./cacheService')
const Util = require('./util')

const SegmentAnalytics = require('analytics-node')
const analytics = new SegmentAnalytics(process.env.SEGMENT_WRITE_KEY)

// TODO move to to env configs
const ADDRESS_SERVER_URL = 'https://beta.3box.io/address-server'
const ORBITDB_PATH = '/opt/orbitdb'
// const IPFS_PATH = '/opt/ipfs'
const IPFS_PATH = null
const REDIS_PATH = 'profilecache.h9luwi.0001.usw2.cache.amazonaws.com'

const DAYS15 = 60 * 60 * 24 * 15 // 15 day ttl

const util = new Util(IPFS_PATH)

function sendInfraMetrics () {
  analytics.track({
    event: 'infra_metrics',
    anonymousId: '3box',
    properties: {
      'total_root_stores': util.getTotalRootStores(),
      'ipfs_disk_size': util.getIPFSDiskUsage(),
      'time': Date.now()
    }
  })
}

async function start () {
  const cache = new RedisCache({ host: REDIS_PATH }, DAYS15)
  const pinning = new Pinning(cache, IPFS_PATH, ORBITDB_PATH, analytics)
  const cacheService = new CacheService(cache, pinning, ADDRESS_SERVER_URL)

  setInterval(sendInfraMetrics, 1800000)

  await pinning.start()
  cacheService.start()
}

start()
