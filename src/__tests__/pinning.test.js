jest.mock('3id-resolver', () => {
  const { getMock3idResolver } = require('./mock3id')
  return { getResolver: getMock3idResolver }
})

const Pinning = require('../pinning')

const EventEmitter = require('events')

const IPFS = require('ipfs')
const defaultsDeep = require('lodash.defaultsdeep')
const tmp = require('tmp-promise')
tmp.setGracefulCleanup()

jest.mock('redis', () => { return require('redis-mock') })
const TestClient = require('./testClient')

// Needed for ipfs spinup/teardown
jest.setTimeout(15000)

const pinningIpfsConfig = {
  Bootstrap: [],
  Addresses: {
    Swarm: [
      '/ip4/127.0.0.1/tcp/4002',
      '/ip4/127.0.0.1/tcp/4003/ws'
    ]
  }
}

const analyticsMock = {
  trackPinDB: jest.fn(),
  trackSyncDB: jest.fn(),
  trackSpaceUpdate: jest.fn(),
  trackPublicUpdate: jest.fn(),
  trackRootUpdate: jest.fn(),
  trackThreadUpdate: jest.fn(),
  trackPrivateUpdate: jest.fn(),
  trackPinDBAddress: jest.fn(),
  trackSpaceUpdateByApp: jest.fn()
}

const mockProfileData = {
  public: {
    name: { timeStamp: 12000, value: 'very name' },
    image: { timeStamp: 13000, value: 'such picture' }
  },
  private: {
    shh: { timeStamp: 14000, value: 'many secret' },
    quiet: { timeStamp: 15000, value: 'wow!' }
  }
}

const mockThreadEntries = [
  { message: 'a great post' },
  { message: 'another great post' }
]

function addReplicatedEmitter (pinning) {
  pinning.events = new EventEmitter()
  const origOpenDB = pinning.openDB
  function myOpenDB (address, responseFn, onReplicatedFn, rootStoreAddress, analyticsFn) {
    const newReplicatedFn = (odbAddress) => {
      const numEntries = pinning.openDBs[odbAddress].db._oplog.values.length
      pinning.events.emit('replicated', { odbAddress, numEntries })
      if (onReplicatedFn) {
        onReplicatedFn(odbAddress)
      }
    }
    origOpenDB.call(pinning, address, responseFn, newReplicatedFn, rootStoreAddress, analyticsFn)
  }
  pinning.openDB = myOpenDB
  return pinning
}

describe('Pinning', () => {
  let tmpDir
  let pinning
  let testClient
  let clientIpfsOpts

  const pinningRoom = 'test-pinning-room'

  beforeEach(async () => {
    tmpDir = await tmp.dir({ unsafeCleanup: true })
    const orbitdbPath = tmpDir.path + '/orbitdb'
    const ipfsPath = tmpDir.path + '/ipfs'
    const ipfsOpts = {
      config: pinningIpfsConfig,
      repo: ipfsPath
    }
    const orbitCacheOpts = null
    const pubSubConfig = null
    const entriesNumCacheOpts = null
    const pinWhitelistDids = null
    const pinWhitelistSpaces = null
    const pinSilent = null

    const ipfs = await IPFS.create(ipfsOpts)
    pinning = new Pinning(ipfs, orbitdbPath, analyticsMock, orbitCacheOpts, pubSubConfig, pinningRoom, entriesNumCacheOpts, pinWhitelistDids, pinWhitelistSpaces, pinSilent)
    await pinning.start()
    await pinning.entriesCache.store.flushall()
    const pinningAddresses = await pinning.ipfs.swarm.localAddrs()
    clientIpfsOpts = { config: { Bootstrap: pinningAddresses } }
    testClient = new TestClient(clientIpfsOpts, pinningRoom)
    await testClient.init()
    pinning = addReplicatedEmitter(pinning)
  })

  afterEach(async () => {
    await testClient.cleanup()
    await pinning.stop()
    await tmpDir.cleanup()
  })

  it('should sync db correctly from client', async () => {
    await testClient.createDB(mockProfileData)
    const pinningReplicatedPromise = new Promise((resolve) => {
      const pinningStoreEntries = {}
      const checkIfStoresReplicated = (data) => {
        const storeType = data.odbAddress.split('.')[1]
        if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
          pinningStoreEntries[storeType] = data.numEntries
        }
        if (Object.keys(pinningStoreEntries).length === 3 &&
            pinningStoreEntries.root === 2 &&
            pinningStoreEntries.public === Object.keys(mockProfileData.public).length &&
            pinningStoreEntries.private === Object.keys(mockProfileData.private).length) {
          pinning.events.off('replicated', checkIfStoresReplicated)
          resolve()
        }
      }
      pinning.events.on('replicated', checkIfStoresReplicated)
    })
    const responsesPromise = new Promise((resolve, reject) => {
      const hasResponses = {}
      testClient.onMsg = (topic, data) => {
        if (data.type === 'HAS_ENTRIES') {
          const storeType = data.odbAddress.split('.')[1]
          if (!hasResponses[storeType] || data.numEntries > hasResponses[storeType]) {
            hasResponses[storeType] = data.numEntries
          }
        }
        if (['root', 'public', 'private'].every(storeType => storeType in hasResponses)) {
          resolve()
        }
      }
    })
    await testClient.announceDB()
    await pinningReplicatedPromise
    await responsesPromise
  })

  it('should sync db correctly to client', async () => {
    // -- Create databases on the pinning node using the test client
    await testClient.createDB(mockProfileData)
    const pinningReplicatedPromise = new Promise((resolve) => {
      const pinningStoreEntries = {}
      const checkIfStoresReplicated = (data) => {
        const storeType = data.odbAddress.split('.')[1]
        if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
          pinningStoreEntries[storeType] = data.numEntries
        }
        if (Object.keys(pinningStoreEntries).length === 3 &&
            pinningStoreEntries.root === 2 &&
            pinningStoreEntries.public === Object.keys(mockProfileData.public).length &&
            pinningStoreEntries.private === Object.keys(mockProfileData.private).length) {
          pinning.events.off('replicated', checkIfStoresReplicated)
          resolve()
        }
      }
      pinning.events.on('replicated', checkIfStoresReplicated)
    })
    await testClient.announceDB()
    await pinningReplicatedPromise

    // -- Create new client with no data
    const client2IpfsOpts = defaultsDeep({
      config: {
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/4106',
            '/ip4/127.0.0.1/tcp/4107/ws'
          ]
        }
      }
    }, clientIpfsOpts)
    const testClient2 = new TestClient(client2IpfsOpts, pinningRoom)
    await testClient2.init()

    // -- Sync new client to pinning node
    await testClient2.createDB()
    await testClient2.announceDB()
    await testClient2.storeSynced()

    const expectedProfile = Object.keys(mockProfileData.public).reduce((acc, key) => {
      acc[key] = mockProfileData.public[key].value
      return acc
    }, {})
    const expectedPrivate = Object.keys(mockProfileData.private).reduce((acc, key) => {
      acc[key] = mockProfileData.private[key].value
      return acc
    }, {})
    expect(await testClient2.getProfile()).toEqual(expectedProfile)
    expect(await testClient2.getPrivate()).toEqual(expectedPrivate)
    testClient2.cleanup()
  }, 30000)

  it('dbs should close after 30 min, but not before', async () => {
    await testClient.createDB(mockProfileData)
    const pinningReplicatedPromise = new Promise((resolve) => {
      const pinningStoreEntries = {}
      const checkIfStoresReplicated = (data) => {
        const storeType = data.odbAddress.split('.')[1]
        if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
          pinningStoreEntries[storeType] = data.numEntries
        }
        if (Object.keys(pinningStoreEntries).length === 3 &&
            pinningStoreEntries.root === 2 &&
            pinningStoreEntries.public === Object.keys(mockProfileData.public).length &&
            pinningStoreEntries.private === Object.keys(mockProfileData.private).length) {
          pinning.events.off('replicated', checkIfStoresReplicated)
          resolve()
        }
      }
      pinning.events.on('replicated', checkIfStoresReplicated)
    })
    await testClient.announceDB()
    await pinningReplicatedPromise

    await pinning.checkAndCloseDBs()
    let numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(3)
    // make 20 min pass
    // hacky way to get around Date.now()
    Object.keys(pinning.openDBs).map(key => {
      pinning.openDBs[key].latestTouch -= 20 * 60 * 1000
    })
    await pinning.checkAndCloseDBs()
    numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(3)
    // make additional 10 min pass
    Object.keys(pinning.openDBs).map(key => {
      pinning.openDBs[key].latestTouch -= 10 * 60 * 1000
    })
    await pinning.checkAndCloseDBs()
    numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(0)
  })

  describe('Threads', () => {
    beforeEach(async () => {
      await testClient.createDB(mockProfileData)
      const pinningReplicatedPromise = new Promise((resolve) => {
        const pinningStoreEntries = {}
        const checkIfStoresReplicated = (data) => {
          const storeType = data.odbAddress.split('.')[1]
          if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
            pinningStoreEntries[storeType] = data.numEntries
          }
          if (Object.keys(pinningStoreEntries).length === 3 &&
              pinningStoreEntries.root === 2 &&
              pinningStoreEntries.public === Object.keys(mockProfileData.public).length &&
              pinningStoreEntries.private === Object.keys(mockProfileData.private).length) {
            pinning.events.off('replicated', checkIfStoresReplicated)
            resolve()
          }
        }
        pinning.events.on('replicated', checkIfStoresReplicated)
      })
      await testClient.announceDB()
      await pinningReplicatedPromise
    })

    // TODO: reproduce root failure of following tests (see https://github.com/3box/3box-pinning-node/issues/288)
    it.skip('Test to reproduce error in retrieving the thread access node consecutive times', async () => {
      await testClient.createThread(mockThreadEntries)
      const CID = require('cids')
      const cid = new CID('zdpuAqS4Qc9Ff3uuUyT6juCpsC7waWw6NDVqtdPYYL9EZRnYx')
      console.log('STARTING')
      for (let i = 0; i < 10; i++) {
        console.log('fetching...', i)
        console.log('MANIFEST', await pinning.ipfs.dag.get(cid))
        // without this delay, consecutive calls fail
        // await new Promise(resolve => setTimeout(resolve, 100))
      }
    })

    // TODO: fix (see https://github.com/3box/3box-pinning-node/issues/288)
    it.skip('should pin thread data correctly from client', async () => {
      await testClient.createThread(mockThreadEntries)
      const pinningThreadCreatedPromise = new Promise((resolve) => {
        const pinningStoreEntries = {}
        const checkIfThreadCreated = (data) => {
          console.log('replicated', data)
          const storeType = data.odbAddress.split('.')[1]
          if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
            pinningStoreEntries[storeType] = data.numEntries
          }
          if (pinningStoreEntries.thread === 2) {
            pinning.events.off('replicated', checkIfThreadCreated)
            resolve()
          }
        }
        pinning.events.on('replicated', checkIfThreadCreated)
      })
      await testClient.announceThread()
      await pinningThreadCreatedPromise
    })

    // TODO: fix (see https://github.com/3box/3box-pinning-node/issues/288)
    it.skip('should sync pinned thread to client', async () => {
      // -- Create thread on the pinning node using the test client
      await testClient.createThread(mockThreadEntries)
      const pinningThreadCreatedPromise = new Promise((resolve) => {
        const pinningStoreEntries = {}
        const checkIfThreadCreated = (data) => {
          console.log('replicated', data)
          const storeType = data.odbAddress.split('.')[1]
          if (!pinningStoreEntries[storeType] || data.numEntries > pinningStoreEntries[storeType]) {
            pinningStoreEntries[storeType] = data.numEntries
          }
          if (pinningStoreEntries.thread === 2) {
            pinning.events.off('replicated', checkIfThreadCreated)
            resolve()
          }
        }
        pinning.events.on('replicated', checkIfThreadCreated)
      })
      await testClient.announceThread()
      await pinningThreadCreatedPromise

      // -- Create new client with no data
      const client2IpfsOpts = defaultsDeep({
        config: {
          Addresses: {
            Swarm: [
              '/ip4/127.0.0.1/tcp/4106',
              '/ip4/127.0.0.1/tcp/4107/ws'
            ]
          }
        }
      }, clientIpfsOpts)
      const testClient2 = new TestClient(client2IpfsOpts, pinningRoom)
      await testClient2.init()
      await testClient2.createDB()
      await testClient2.announceDB()
      await testClient2.createThread()
      let posts = await testClient2.getThreadPosts()
      expect(posts).toHaveLength(0)

      // -- Sync new client to pinning node
      await testClient2.createThread()
      await testClient2.announceThread()
      await testClient2.storeSynced({ thread: true })
      posts = await testClient2.getThreadPosts()
      expect(posts[0].message).toEqual(mockThreadEntries[0].message)
      expect(posts[1].message).toEqual(mockThreadEntries[1].message)
      testClient2.cleanup()
    })
  })
})
