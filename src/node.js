#!/usr/bin/env node

const path = require('path')
const Pinning = require('./pinning')
const { ipfsRepo } = require('./s3')
const analytics = require('./analytics')
const { randInt } = require('./util')
const HealthcheckService = require('./healthcheckService')

const env = process.env.NODE_ENV || 'development'
require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${env}`) })

const ORBITDB_PATH = process.env.ORBITDB_PATH
const IPFS_PATH = process.env.IPFS_PATH
const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY
const ANALYTICS_ACTIVE = process.env.ANALYTICS_ACTIVE === 'true'
const ORBIT_REDIS_PATH = process.env.ORBIT_REDIS_PATH
const ENTRIES_NUM_REDIS_PATH = process.env.ENTRIES_NUM_REDIS_PATH
const PUBSUB_REDIS_PATH = process.env.PUBSUB_REDIS_PATH
const PINNING_ROOM = process.env.PINNING_ROOM || '3box-pinning'
const HEALTHCHECK_PORT = process.env.HEALTHCHECK_PORT || 8081

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY
const AWS_S3_ENDPOINT = process.env.AWS_S3_ENDPOINT
const AWS_S3_ADDRESSING_STYLE = process.env.AWS_S3_ADDRESSING_STYLE
const AWS_S3_SIGNATURE_VERSION = process.env.AWS_S3_SIGNATURE_VERSION

const INSTANCE_ID = randInt(10000000000).toString()

const analyticsClient = analytics(SEGMENT_WRITE_KEY, ANALYTICS_ACTIVE)
const orbitCacheRedisOpts = ORBIT_REDIS_PATH ? { host: ORBIT_REDIS_PATH } : null
const entriesNumRedisOpts = ENTRIES_NUM_REDIS_PATH ? { host: ENTRIES_NUM_REDIS_PATH } : null
const pubSubConfig = PUBSUB_REDIS_PATH && INSTANCE_ID ? { redis: { host: PUBSUB_REDIS_PATH }, instanceId: INSTANCE_ID } : null

function prepareIPFSConfig () {
  if (AWS_BUCKET_NAME) {
    if (!IPFS_PATH || !AWS_BUCKET_NAME) {
      throw new Error('Invalid IPFS + s3 configuration')
    }

    const repo = ipfsRepo({
      path: IPFS_PATH,
      bucket: AWS_BUCKET_NAME,
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      endpoint: AWS_S3_ENDPOINT,
      s3ForcePathStyle: AWS_S3_ADDRESSING_STYLE === 'path',
      signatureVersion: AWS_S3_SIGNATURE_VERSION
    })
    return { repo }
  } else if (IPFS_PATH) {
    return { repo: IPFS_PATH }
  }

  return {}
}

async function start () {
  const ipfsConfig = prepareIPFSConfig()
  const pinning = new Pinning(ipfsConfig, ORBITDB_PATH, analyticsClient, orbitCacheRedisOpts, pubSubConfig, PINNING_ROOM, entriesNumRedisOpts)
  await pinning.start()
  const healthcheckService = new HealthcheckService(pinning, HEALTHCHECK_PORT)
  healthcheckService.start()
}

start()
