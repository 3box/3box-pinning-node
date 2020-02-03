const Pinning = require('../pinning')

const defaultsDeep = require('lodash.defaultsdeep')
const path = require('path')
const tmp = require('tmp-promise')
tmp.setGracefulCleanup()

jest.mock('redis', () => { return require('redis-mock') })
const TestClient = require('./testClient')
const { registerMock3idResolver } = require('./mock3id')

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

async function closeAllPinningNodeStores (pinning) {
  const promises = Object.keys(pinning.openDBs).map(async key => {
    await pinning.openDBs[key].db.close()
    delete pinning.openDBs[key]
  })
  await Promise.all(promises)
}

describe('Pinning', () => {
  let tmpDir
  let pinning
  let testClient
  let clientIpfsOpts

  const pinningRoom = 'test-pinning-room'

  beforeAll(async () => {
    // await registerMock3idResolver()
  })

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

    pinning = new Pinning(ipfsOpts, orbitdbPath, analyticsMock, orbitCacheOpts, pubSubConfig, pinningRoom, entriesNumCacheOpts, pinWhitelistDids, pinWhitelistSpaces, pinSilent)
    await pinning.start()
    const pinningAddresses = await pinning.ipfs.swarm.localAddrs()
    clientIpfsOpts = { config: { Bootstrap: pinningAddresses } }
    testClient = new TestClient(clientIpfsOpts, pinningRoom)
    await testClient.init()
    await registerMock3idResolver()
  })

  afterEach(async () => {
    await testClient.cleanup()
    await pinning.stop()
    await tmpDir.cleanup()
  })

  it('should sync db correctly from client', async () => {
    await testClient.createDB(mockProfileData)
    const responsesPromise = new Promise((resolve, reject) => {
      const hasResponses = []
      testClient.onMsg = (topic, data) => {
        if (data.type === 'HAS_ENTRIES') {
          expect(data.numEntries).toEqual(0)
          if (hasResponses.indexOf(data.odbAddress) === -1) {
            hasResponses.push(data.odbAddress)
          }
        }
        if (hasResponses.length === 3) {
          expect(hasResponses).toContain(testClient.rootStore.address.toString())
          expect(hasResponses).toContain(testClient.pubStore.address.toString())
          expect(hasResponses).toContain(testClient.privStore.address.toString())
          resolve()
        }
      }
    })
    await testClient.announceDB()
    await responsesPromise
  })

  it('should sync db correctly to client', async () => {
    // -- Create databases on the pinning node using the test client
    await testClient.createDB(mockProfileData)
    const responsesPromise = new Promise((resolve, reject) => {
      const hasResponses = []
      testClient.onMsg = (topic, data) => {
        if (data.type === 'HAS_ENTRIES') {
          if (hasResponses.indexOf(data.odbAddress) === -1) {
            hasResponses.push(data.odbAddress)
          }
        }
        if (hasResponses.length === 3) {
          resolve()
        }
      }
    })
    await testClient.announceDB()
    await responsesPromise

    // We have to wait manually for the remote db to sync all entries because we have no sync event
    await new Promise(resolve => setTimeout(resolve, 3000))

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
    const responsesPromise = new Promise((resolve, reject) => {
      const hasResponses = []
      testClient.onMsg = (topic, data) => {
        if (data.type === 'HAS_ENTRIES') {
          if (hasResponses.indexOf(data.odbAddress) === -1) {
            hasResponses.push(data.odbAddress)
          }
        }
        if (hasResponses.length === 3) {
          resolve()
        }
      }
    })
    await testClient.announceDB()
    await responsesPromise

    // We have to wait manually for the remote db to sync all entries because we have no sync event
    await new Promise(resolve => setTimeout(resolve, 3000))

    pinning.checkAndCloseDBs()
    let numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(3)
    // make 20 min pass
    // hacky way to get around Date.now()
    Object.keys(pinning.openDBs).map(key => {
      pinning.openDBs[key].latestTouch -= 20 * 60 * 1000
    })
    pinning.checkAndCloseDBs()
    numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(3)
    // make additional 10 min pass
    Object.keys(pinning.openDBs).map(key => {
      pinning.openDBs[key].latestTouch -= 10 * 60 * 1000
    })
    pinning.checkAndCloseDBs()
    numOpenDBs = Object.keys(pinning.openDBs).length
    expect(numOpenDBs).toEqual(0)
  })

  describe('Threads', () => {
    beforeEach(async () => {
      await testClient.createDB(mockProfileData)
      const responsesPromise = new Promise((resolve, reject) => {
        const hasResponses = []
        testClient.onMsg = (topic, data) => {
          if (data.type === 'HAS_ENTRIES') {
            if (hasResponses.indexOf(data.odbAddress) === -1) {
              hasResponses.push(data.odbAddress)
            }
          }
          if (hasResponses.length === 3) {
            resolve()
          }
        }
      })
      await testClient.announceDB()
      await responsesPromise

      // We have to wait manually for the remote db to sync all entries because we have no sync event
      await new Promise(resolve => setTimeout(resolve, 3000))
    })

    it('should pin thread correctly from client', async () => {
      await testClient.createThread(mockThreadEntries)
      const responsesPromise = new Promise((resolve, reject) => {
        testClient.onMsg = (topic, data) => {
          if (data.type === 'HAS_ENTRIES') {
            expect(data.numEntries).toEqual(0)
            resolve()
          }
        }
      })
      await testClient.announceThread()
      await responsesPromise
      // wait for thread to sync
      await new Promise((resolve, reject) => { setTimeout(resolve, 5000) })
    })

    it('should sync pinned data to client', async () => {
      // -- Create thread on the pinning node using the test client
      await testClient.createThread(mockThreadEntries)
      const responsesPromise = new Promise((resolve, reject) => {
        testClient.onMsg = (topic, data) => {
          if (data.type === 'HAS_ENTRIES') {
            resolve()
          }
        }
      })
      await testClient.announceThread()
      await responsesPromise

      // We have to wait manually for the remote db to sync all entries because we have no sync event
      await new Promise(resolve => setTimeout(resolve, 3000))

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
    }, 30000)
  })
})
