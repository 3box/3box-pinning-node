const S3Store = require('datastore-s3')
// const S3 = require('aws-sdk/clients/s3')
const AWS = require('aws-sdk')

const https = require('https')

const agent = new https.Agent({
  maxSockets: 300,
  keepAlive: true
})

AWS.config.update({
  logger: console,
  httpOptions: {
    timeout: 45000,
    connectTimeout: 45000,
    agent: agent
  },
  maxRetries: 10,
  retryDelayOptions: {
    base: 500
  }
})

const S3 = AWS.S3
const IPFSRepo = require('ipfs-repo')

// Redundant with createRepo in datastore-s3, but needed to configure
// additional S3 client parameters not otherwise exposed

// A mock lock
const notALock = {
  getLockfilePath: () => {},
  lock: (_) => notALock.getCloser(),
  getCloser: (_) => ({
    close: () => {}
  }),
  locked: (_) => false
}

const ipfsRepo = (config) => {
  const {
    path,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    s3ForcePathStyle,
    signatureVersion
  } = config
  const createIfMissing = true

  const storeConfig = {
    s3: new S3({
      params: {
        Bucket: bucket
      },
      accessKeyId,
      secretAccessKey,
      endpoint,
      s3ForcePathStyle,
      signatureVersion,
      httpOptions: {
        agent
      }
    }),
    createIfMissing
  }

  return new IPFSRepo(path, {
    storageBackends: {
      blocks: S3Store,
      datastore: S3Store,
      root: S3Store,
      keys: S3Store
    },
    storageBackendOptions: {
      blocks: storeConfig,
      datastore: storeConfig,
      root: storeConfig,
      keys: storeConfig
    },
    lock: notALock
  })
}

module.exports = { ipfsRepo }
