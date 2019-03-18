const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')

const Pinning = require('../pinning')

const PINNING_ROOM = '3box-pinning'
const IPFS_PATH_1 = './tmp/ipfs1'
const IPFS_PATH_2 = './tmp/ipfs2'
const ODB_PATH_1 = './tmp/orbitdb1'
const ODB_PATH_2 = './tmp/orbitdb2'
const PROFILE = { image: 'such picture', name: 'very name' }
const PRIV_IMG = { quiet: 'wow!', shh: 'many secret' }
const cache = {
  invalidate: jest.fn()
}

describe('Pinning', () => {
  let pinning
  let testClient
  let analyticsMock

  jest.setTimeout(30000)

  beforeAll(async () => {
    analyticsMock = {
      trackOpenDB: jest.fn(),
      trackGetProfile: jest.fn(),
      trackPinDB: jest.fn(),
      trackGetThread: jest.fn()
    }
    pinning = new Pinning(cache, IPFS_PATH_1, ODB_PATH_1, analyticsMock)
    testClient = new TestClient()
    testClient.onMsg = jest.fn()
    await Promise.all([pinning.start(), testClient.init()])
  })

  beforeEach(() => {
    testClient.onMsg.mockClear()
    cache.invalidate.mockClear()
  })

  it('should invalidate DB cache correctly', async () => {
    const spaceDBAddr = '/orbitdb/QmManifestHash/3box.space.spaceName.keyvalue'
    const publicDBAddr = '/orbitdb/QmManifestHash/somedata.public'
    const rootStoreDBAddr = '/orbitdb/QmManifestHash/somedata.root'
    pinning.invalidateDBCache(rootStoreDBAddr)
    expect(cache.invalidate).toHaveBeenCalledWith(`space-list_${rootStoreDBAddr}`)
    cache.invalidate.mockClear()
    pinning.invalidateDBCache(publicDBAddr, rootStoreDBAddr)
    expect(cache.invalidate).toHaveBeenCalledWith(rootStoreDBAddr)
    cache.invalidate.mockClear()
    pinning.invalidateDBCache(spaceDBAddr, rootStoreDBAddr)
    expect(cache.invalidate).toHaveBeenCalledWith(`${rootStoreDBAddr}_spaceName`)
    cache.invalidate.mockClear()
  })

  it('should sync db correctly from client', async () => {
    await testClient.createDB(true)
    const responsesPromise = new Promise((resolve, reject) => {
      let hasResponses = []
      testClient.onMsg.mockImplementation((topic, data) => {
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
      })
    })
    testClient.announceDB()
    await responsesPromise
    expect(cache.invalidate).toHaveBeenCalledTimes(4)
    expect(cache.invalidate).toHaveBeenCalledWith(testClient.rootStore.address.toString())
    // wait for stores to sync
    await new Promise((resolve, reject) => { setTimeout(resolve, 3000) })
    expect(cache.invalidate).toHaveBeenCalledWith('space-list_' + testClient.rootStore.address.toString())
  })

  it('should sync db correctly to client', async () => {
    await testClient.reset()
    await closeAllStores(pinning)
    await testClient.createDB(false)
    const responsesPromise = new Promise((resolve, reject) => {
      let hasResponses = []
      testClient.onMsg.mockImplementation((topic, data) => {
        if (data.type === 'HAS_ENTRIES') {
          expect(data.numEntries).toEqual(2)
          hasResponses.push(data.odbAddress)
        }
        if (hasResponses.length === 3) {
          expect(hasResponses).toContain(testClient.rootStore.address.toString())
          expect(hasResponses).toContain(testClient.pubStore.address.toString())
          expect(hasResponses).toContain(testClient.privStore.address.toString())
          resolve()
        }
      })
    })
    const dbSyncPromise = testClient.syncDB()
    testClient.announceDB()
    await responsesPromise
    await dbSyncPromise
    expect(cache.invalidate).toHaveBeenCalledWith(testClient.rootStore.address.toString())
    expect(cache.invalidate).toHaveBeenCalledWith('space-list_' + testClient.rootStore.address.toString())
    expect(await testClient.getProfile()).toEqual(PROFILE)
    expect(await testClient.getPrivImg()).toEqual(PRIV_IMG)
  })

  it('dbs should close after 30 min, but not before', async () => {
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

  it('should get profile correctly, when stores closed', async () => {
    await closeAllStores(pinning)
    const rsAddr = testClient.rootStore.address.toString()
    const profile = await pinning.getProfile(rsAddr)
    expect(profile).toEqual(PROFILE)
  })

  it('should get profile correctly, when stores open', async () => {
    const rsAddr = testClient.rootStore.address.toString()
    const profile = await pinning.getProfile(rsAddr)
    expect(profile).toEqual(PROFILE)
  })

  describe('Threads', () => {
    it('should pin thread correctly from client', async () => {
      await testClient.createThread(true)
      const responsesPromise = new Promise((resolve, reject) => {
        testClient.onMsg.mockImplementation((topic, data) => {
          if (data.type === 'HAS_ENTRIES') {
            expect(data.numEntries).toEqual(0)
            resolve()
          }
        })
      })
      testClient.announceThread()
      await responsesPromise
      expect(cache.invalidate).toHaveBeenCalledTimes(1)
      expect(cache.invalidate).toHaveBeenCalledWith('3box.thread.myspace.coolthread')
      // wait for thread to sync
      await new Promise((resolve, reject) => { setTimeout(resolve, 3000) })
    })

    it('should get tread post correctly', async () => {
      const posts = await pinning.getThread('3box.thread.myspace.coolthread')
      expect(posts[0].message).toEqual('a great post')
      expect(posts[1].message).toEqual('another great post')
    })

    it('should sync pinned data to client', async () => {
      await closeAllStores(pinning)
      await testClient.createThread(false)
      const responsesPromise = new Promise((resolve, reject) => {
        testClient.onMsg.mockImplementation((topic, data) => {
          if (data.type === 'HAS_ENTRIES') {
            expect(data.numEntries).toEqual(2)
            resolve()
          }
        })
      })
      const dbSyncPromise = testClient.syncDB(true)
      testClient.announceThread()
      await responsesPromise
      await dbSyncPromise
      expect(cache.invalidate).toHaveBeenCalledTimes(1)
      expect(cache.invalidate).toHaveBeenCalledWith('3box.thread.myspace.coolthread')
      let posts = await testClient.getThreadPosts()
      expect(posts[0].message).toEqual('a great post')
      expect(posts[1].message).toEqual('another great post')
    })
  })
})

const closeAllStores = async pinning => {
  const promises = Object.keys(pinning.openDBs).map(async key => {
    await pinning.openDBs[key].db.close()
    delete pinning.openDBs[key]
  })
  await Promise.all(promises)
}

class TestClient {
  constructor () {
    this.onMsg = () => {}
  }

  async init () {
    this.ipfs = await initIPFS()
  }

  async createDB (withData) {
    const ipfsId = await this.ipfs.id()
    this.orbitdb = new OrbitDB(this.ipfs, ODB_PATH_2)
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
    this.rootStore = await this.orbitdb.feed('rs.root')
    this.pubStore = await this.orbitdb.keyvalue('test.public')
    this.privStore = await this.orbitdb.keyvalue('test.private')
    await this.rootStore.add({ odbAddress: this.pubStore.address.toString() })
    await this.rootStore.add({ odbAddress: this.privStore.address.toString() })
    if (withData) {
      await this.pubStore.put('name', { value: 'very name' })
      await this.pubStore.put('image', { value: 'such picture' })
      await this.privStore.put('shh', { value: 'many secret' })
      await this.privStore.put('quiet', { value: 'wow!' })
    }
  }

  announceDB () {
    const rootStoreAddress = this.rootStore.address.toString()
    this.pubsub.subscribe(PINNING_ROOM, this.onMsg.bind(this), () => {
      this.pubsub.publish(PINNING_ROOM, { type: 'PIN_DB', odbAddress: rootStoreAddress })
    })
  }

  async syncDB (thread) {
    const syncStore = async store => {
      return new Promise((resolve, reject) => {
        store.events.on('replicate.progress',
          (odbAddress, entryHash, entry, num, max) => {
            if (num === max) {
              store.events.on('replicated', () => {
                resolve()
              })
            }
          }
        )
      })
    }
    if (thread) {
      await syncStore(this.thread)
    } else {
      await Promise.all([
        syncStore(this.pubStore),
        syncStore(this.privStore)
      ])
    }
  }

  async createThread (withData) {
    const tName = '3box.thread.myspace.coolthread'
    this.thread = await this.orbitdb.log(tName, { write: ['*'] })
    if (withData) {
      await this.thread.add({ message: 'a great post' })
      await this.thread.add({ message: 'another great post' })
    }
  }

  async dropThread () {
    await this.thread.drop()
  }

  announceThread () {
    const address = this.thread.address.toString()
    this.pubsub.publish(PINNING_ROOM, { type: 'SYNC_DB', odbAddress: address, thread: true })
  }

  async getThreadPosts () {
    return this.thread
      .iterator({ limit: -1 })
      .collect().map(entry => {
        let post = entry.payload.value
        post.postId = entry.hash
        return post
      })
  }

  async getProfile () {
    const profile = this.pubStore.all()
    let parsedProfile = {}
    Object.keys(profile).map(key => { parsedProfile[key] = profile[key].value })
    return parsedProfile
  }

  async getPrivImg () {
    const img = this.privStore.all()
    let parsedProfile = {}
    Object.keys(img).map(key => { parsedProfile[key] = img[key].value })
    return parsedProfile
  }

  async reset () {
    await Promise.all([
      this.rootStore.drop(),
      this.pubStore.drop(),
      this.privStore.drop()
    ])
    await this.orbitdb.stop()
    await this.pubsub.disconnect()
  }
}

const CONF = {
  EXPERIMENTAL: {
    pubsub: true
  },
  repo: IPFS_PATH_2,
  config: {
    Addresses: {
      Swarm: [
        '/ip4/127.0.0.1/tcp/4006',
        '/ip4/127.0.0.1/tcp/4007/ws'
      ],
      API: '/ip4/127.0.0.1/tcp/5004',
      Gateway: '/ip4/127.0.0.1/tcp/9092'
    }
  }
}

const initIPFS = async () => {
  return new Promise((resolve, reject) => {
    let ipfs = new IPFS(CONF)
    ipfs.on('error', reject)
    ipfs.on('ready', () => resolve(ipfs))
  })
}
