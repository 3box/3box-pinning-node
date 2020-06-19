#!/usr/bin/env node

const path = require('path')
const IPFS = require('ipfs')
const ipfsClient = require('ipfs-http-client')
const Pinning = require('./pinning')
const { ipfsRepo } = require('./s3')
const analytics = require('./analytics')
const { isBooleanStringSet } = require('./util')
const HealthcheckService = require('./healthcheckService')

const env = process.env.NODE_ENV || 'development'
require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${env}`) })

const ORBITDB_PATH = process.env.ORBITDB_PATH
const IPFS_PATH = process.env.IPFS_PATH
const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY
const ANALYTICS_ACTIVE = process.env.ANALYTICS_ACTIVE === 'true'
const ORBIT_REDIS_PATH = process.env.ORBIT_REDIS_PATH
const ENTRIES_NUM_REDIS_PATH = process.env.ENTRIES_NUM_REDIS_PATH
// const PUBSUB_REDIS_PATH = process.env.PUBSUB_REDIS_PATH
const PINNING_ROOM = process.env.PINNING_ROOM || '3box-pinning'
const HEALTHCHECK_PORT = process.env.HEALTHCHECK_PORT || 8081

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY
const AWS_S3_ENDPOINT = process.env.AWS_S3_ENDPOINT
const AWS_S3_ADDRESSING_STYLE = process.env.AWS_S3_ADDRESSING_STYLE
const AWS_S3_SIGNATURE_VERSION = process.env.AWS_S3_SIGNATURE_VERSION

const PIN_SILENT = isBooleanStringSet(process.env.PIN_SILENT)
const PIN_WHITELIST_DIDS = process.env.PIN_WHITELIST_DIDS ? process.env.PIN_WHITELIST_DIDS.split(',') : null
const PIN_WHITELIST_SPACES = process.env.PIN_WHITELIST_SPACES ? process.env.PIN_WHITELIST_SPACES.split(',') : null

// const INSTANCE_ID = randInt(10000000000).toString()

const analyticsClient = analytics(SEGMENT_WRITE_KEY, ANALYTICS_ACTIVE)
const orbitCacheRedisOpts = ORBIT_REDIS_PATH ? { host: ORBIT_REDIS_PATH } : null
const entriesNumRedisOpts = ENTRIES_NUM_REDIS_PATH ? { host: ENTRIES_NUM_REDIS_PATH } : null
// const pubSubConfig = PUBSUB_REDIS_PATH && INSTANCE_ID ? { redis: { host: PUBSUB_REDIS_PATH }, instanceId: INSTANCE_ID } : null
const pubSubConfig = null

function prepareIPFSConfig () {
  let repo
  if (AWS_BUCKET_NAME) {
    if (!IPFS_PATH) {
      throw new Error('Invalid IPFS + s3 configuration')
    }

    repo = ipfsRepo({
      path: IPFS_PATH,
      bucket: AWS_BUCKET_NAME,
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      endpoint: AWS_S3_ENDPOINT,
      s3ForcePathStyle: AWS_S3_ADDRESSING_STYLE === 'path',
      signatureVersion: AWS_S3_SIGNATURE_VERSION
    })
  } else if (IPFS_PATH) {
    repo = IPFS_PATH
  }

  let swarmAddresses = [
    '/ip4/0.0.0.0/tcp/4002',
    '/ip4/127.0.0.1/tcp/4003/ws'
  ]
  if (process.env.RENDEZVOUS_ADDRESS) {
    swarmAddresses = [...swarmAddresses, process.env.RENDEZVOUS_ADDRESS]
  }

  const ipfsOpts = {
    repo,
    preload: { enabled: false },
    config: {
      Bootstrap: [],
      Addresses: {
        Swarm: swarmAddresses
      },
      Swarm: {
        ConnMgr: {
          LowWater: 700,
          HighWater: 1500
        }
      }
    }
  }

  return ipfsOpts
}

async function retryBackoff (fn, maxBackoffTime = 60000) {
  async function _retryBackoff (fn, maxBackoffTime, jitter, wait) {
    if (wait > maxBackoffTime) return Promise.reject(new Error('Max backoff time exceeded'))
    try {
      return await fn()
    } catch (e) {
      console.warn(`call failed, retrying in ${wait} ms`)
      await new Promise(resolve => setTimeout(resolve, wait + Math.random() * jitter))
      return _retryBackoff(fn, maxBackoffTime, jitter, wait * 2)
    }
  }
  return _retryBackoff(fn, maxBackoffTime, 100, 1000)
}

async function start () {
  let ipfs
  if (process.env.IPFS_API_URL) {
    ipfs = ipfsClient(process.env.IPFS_API_URL)
    await retryBackoff(ipfs.id)
  } else {
    const ipfsConfig = prepareIPFSConfig()
    ipfs = await IPFS.create(ipfsConfig)
  }

  const pinning = new Pinning(ipfs, ORBITDB_PATH, analyticsClient, orbitCacheRedisOpts, pubSubConfig, PINNING_ROOM, entriesNumRedisOpts, PIN_WHITELIST_DIDS, PIN_WHITELIST_SPACES, PIN_SILENT)
  await pinning.start()
  const healthcheckService = new HealthcheckService(pinning, HEALTHCHECK_PORT)
  healthcheckService.start()
}

start()
