const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
const {
  OdbIdentityProvider,
  LegacyIPFS3BoxAccessController,
  ThreadAccessController,
  ModeratorAccessController
} = require('3box-orbitdb-plugins')
const Identities = require('orbit-db-identity-provider')
Identities.addIdentityProvider(OdbIdentityProvider)
const AccessControllers = require('orbit-db-access-controllers')
AccessControllers.addAccessController({ AccessController: LegacyIPFS3BoxAccessController })
AccessControllers.addAccessController({ AccessController: ThreadAccessController })
AccessControllers.addAccessController({ AccessController: ModeratorAccessController })
const didJWT = require('did-jwt')
const { registerMethod } = require('did-resolver')
const { makeIPFS } = require('./tools')

const Pinning = require('../pinning')

const PINNING_ROOM = '3box-pinning'
const IPFS_PATH_1 = './tmp/ipfs1'
const IPFS_PATH_2 = './tmp/ipfs2'
const ODB_PATH_1 = './tmp/orbitdb1'
const ODB_PATH_2 = './tmp/orbitdb2'

// Data to be pushed to the store
const PUBLIC_NAME = { timeStamp: 12000, value: 'very name' }
const PUBLIC_IMAGE = { timeStamp: 13000, value: 'such picture' }
const PRIVATE_SHH = { timeStamp: 14000, value: 'many secret' }
const PRIVATE_QUIET = { timeStamp: 15000, value: 'wow!' }

// const PROFILE_ONLY_VALUES = {
//   name: PUBLIC_NAME.value,
//   image: PUBLIC_IMAGE.value
// }

// const PRIV_IMG_ONLY_VALUES = {
//   quiet: PRIVATE_QUIET.value,
//   shh: PRIVATE_SHH.value
// }

const THREEID_MOCK = {
  DID: 'did:3:asdfasdf',
  getKeyringBySpaceName: () => {
    return {
      getPublicKeys: () => {
        return { signingKey: '044f5c08e2150b618264c4794d99a22238bf60f1133a7f563e74fcf55ddb16748159872687a613545c65567d2b7a4d4e3ac03763e1d9a5fcfe512a371faa48a781' }
      }
    }
  },
  signJWT: payload => {
    return didJWT.createJWT(payload, {
      signer: didJWT.SimpleSigner('95838ece1ac686bde68823b21ce9f564bc536eebb9c3500fa6da81f17086a6be'),
      issuer: 'did:3:asdfasdf'
    })
  }
}
// we need to have a fake 3id resolver since we have a fake 3id
const register3idResolver = () => registerMethod('3', async () => {
  return {
    '@context': 'https://w3id.org/did/v1',
    id: 'did:3:asdfasdf',
    publicKey: [{
      id: 'did:3:asdfasdf#signingKey',
      type: 'Secp256k1VerificationKey2018',
      publicKeyHex: '044f5c08e2150b618264c4794d99a22238bf60f1133a7f563e74fcf55ddb16748159872687a613545c65567d2b7a4d4e3ac03763e1d9a5fcfe512a371faa48a781'
    }],
    authentication: [{
      type: 'Secp256k1SignatureAuthentication2018',
      publicKey: 'did:3:asdfasdf#signingKey'
    }]
  }
})

const cache = {
  write: jest.fn()
}

describe('Pinning', () => {
  let pinning
  let testClient
  let analyticsMock

  jest.setTimeout(30000)

  beforeAll(async () => {
    analyticsMock = {
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
    pinning = new Pinning({ repo: IPFS_PATH_1 }, ODB_PATH_1, analyticsMock, undefined, undefined, PINNING_ROOM)
    testClient = new TestClient()
    testClient.onMsg = jest.fn()
    await Promise.all([pinning.start(), testClient.init()])

    register3idResolver()
  })

  beforeEach(() => {
    testClient.onMsg.mockClear()
    cache.write.mockClear()
  })

  it('should sync db correctly from client', async () => {
    await testClient.createDB(true)
    const responsesPromise = new Promise((resolve, reject) => {
      const hasResponses = []
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
    // wait for stores to sync
    await new Promise((resolve, reject) => { setTimeout(resolve, 3000) })
    // TODO
    // expect(cache.write).toHaveBeenCalledWith('space-list_' + testClient.rootStore.address.toString())
  })

  // TODO
  // it('should sync db correctly to client', async () => {
  //   await testClient.reset()
  //   await closeAllStores(pinning)
  //   await testClient.createDB(false)
  //   const responsesPromise = new Promise((resolve, reject) => {
  //     let hasResponses = []
  //     testClient.onMsg.mockImplementation((topic, data) => {
  //       if (data.type === 'HAS_ENTRIES') {
  //         expect(data.numEntries).toEqual(2)
  //         hasResponses.push(data.odbAddress)
  //       }
  //       if (hasResponses.length === 3) {
  //         expect(hasResponses).toContain(testClient.rootStore.address.toString())
  //         expect(hasResponses).toContain(testClient.pubStore.address.toString())
  //         expect(hasResponses).toContain(testClient.privStore.address.toString())
  //         resolve()
  //       }
  //     })
  //   })
  //   await new Promise((resolve, reject) => { setTimeout(resolve, 5000) })
  //   const dbSyncPromise = testClient.syncDB()
  //   testClient.announceDB()
  //   await responsesPromise
  //   await dbSyncPromise
  //
  //   expect(await testClient.getProfile()).toEqual(PROFILE_ONLY_VALUES)
  //   expect(await testClient.getPrivImg()).toEqual(PRIV_IMG_ONLY_VALUES)
  // })

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
      // wait for thread to sync
      await new Promise((resolve, reject) => { setTimeout(resolve, 5000) })
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
      // for some reason there is an issue with the db not getting fully
      // replicated in time even after the dbSyncPromise. Wait for 0.5 s
      await new Promise((resolve, reject) => { setTimeout(resolve, 500) })
      const posts = await testClient.getThreadPosts()
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
    this.identity = await Identities.createIdentity({
      type: '3ID',
      threeId: THREEID_MOCK,
      identityKeysPath: './tmp/odbIdentityKeys'
    })
  }

  async createDB (withData) {
    const ipfsId = await this.ipfs.id()
    this.orbitdb = await OrbitDB.createInstance(this.ipfs, {
      directory: ODB_PATH_2,
      identity: this.identity
    })
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
    const key = THREEID_MOCK.getKeyringBySpaceName().getPublicKeys(true).signingKey
    const opts = {
      format: 'dag-pb',
      accessController: {
        write: [key],
        type: 'legacy-ipfs-3box',
        skipManifest: true
      }
    }
    this.rootStore = await this.orbitdb.feed('rs.root', opts)
    this.pubStore = await this.orbitdb.keyvalue('test.public', opts)
    this.privStore = await this.orbitdb.keyvalue('test.private', opts)
    await this.rootStore.add({ odbAddress: this.pubStore.address.toString() })
    await this.rootStore.add({ odbAddress: this.privStore.address.toString() })
    if (withData) {
      await this.pubStore.put('name', PUBLIC_NAME)
      await this.pubStore.put('image', PUBLIC_IMAGE)
      await this.privStore.put('shh', PRIVATE_SHH)
      await this.privStore.put('quiet', PRIVATE_QUIET)
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
    this.thread = await this.orbitdb.feed(tName, {
      identity: this.identity,
      accessController: {
        type: 'thread-access',
        threadName: tName,
        members: false,
        firstModerator: THREEID_MOCK.DID,
        identity: this.identity
      }
    })
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
        const post = Object.assign({ postId: entry.hash }, entry.payload.value)
        return post
      })
  }

  async getProfile () {
    const profile = this.pubStore.all
    const parsedProfile = {}
    Object.keys(profile).map(key => { parsedProfile[key] = profile[key].value })
    return parsedProfile
  }

  async getPrivImg () {
    const img = this.privStore.all
    const parsedProfile = {}
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
  return makeIPFS(CONF)
}
