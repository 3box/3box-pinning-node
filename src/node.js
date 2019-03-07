#!/usr/bin/env node

const path = require('path')
const Pinning = require('./pinning')
const { ipfsRepo } = require('./s3')
const Util = require('./util')
const Analytics = require('./analytics')

const env = process.env.NODE_ENV || 'development'
require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${env}`) })

const ORBITDB_PATH = process.env.ORBITDB_PATH
const IPFS_PATH = process.env.IPFS_PATH
const SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY
const ANALYTICS_ACTIVE = process.env.ANALYTICS_ACTIVE || true

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

const analyticsClient = new Analytics(SEGMENT_WRITE_KEY, ANALYTICS_ACTIVE)
const util = new Util(ORBITDB_PATH, IPFS_PATH)

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

async function start () {
  const ipfsConfig = prepareIPFSConfig()
  const pinning = new Pinning(ipfsConfig, ORBITDB_PATH, analyticsClient)
  await pinning.start()
  setInterval(sendInfraMetrics, 1800000)
}

start()
