const S3Store = require('datastore-s3')
const blocids = ['CIQMQPIVRAWTIBMNG3IMZB4XBLCMAQWJGDHTFEHIW4VUHIPWJAB24HY', 'CIQC6ZB3D7A4L3LVORWKCHG4UOBOCTQQR5HWM3MSUN44G4KDVVB7IEY', 'CIQKUBCQ54HHQ3PLPADO74WCAS4LTC4YAU5VIDAHRVYJXWC5FXEY44Y', 'CIQOHMGEIKMPYHAUTL57JSEZN64SIJ5OIHSGJG4TJSSJLGI3PBJLQVI']
const logOnMatch = key => {
  const str = key.toString()
  if (blocids.find(e => str.includes(e))) {
    console.trace('For Key:' + str)
  }
}

class S3StoreLogger extends S3Store {
  async get (key) {
    logOnMatch(key)
    return super.get(key)
  }

  async has (key) {
    logOnMatch(key)
    return super.get(key)
  }
}

// const S3 = require('aws-sdk/clients/s3')
const AWS = require('aws-sdk')

const LevelStore = require('datastore-level')

// const store = new LevelStore('datastore')

// const memStore = new LevelStore('my/mem/store', {
//   db: require('level-mem')
// })

const https = require('https')

const agent = new https.Agent({
  maxSockets: 300,
  keepAlive: true
})

AWS.config.update({
  // logger: console,
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
      signatureVersion
    }),
    createIfMissing
  }

  return new IPFSRepo(path, {
    storageBackends: {
      blocks: S3StoreLogger,
      // datastore: S3StoreLogger,
      datastore: LevelStore,
      root: S3StoreLogger,
      keys: S3StoreLogger
    },
    storageBackendOptions: {
      blocks: storeConfig,
      // datastore: storeConfig,
      datastore: {
        db: require('level-mem')
      },
      root: storeConfig,
      keys: storeConfig
    },
    // lock: 'memory'
    lock: notALock
  })
}

module.exports = { ipfsRepo }
