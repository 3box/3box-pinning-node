const defaultsDeep = require('lodash.defaultsdeep')
const tmp = require('tmp-promise')
tmp.setGracefulCleanup()

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

const { makeIPFS } = require('./tools')
const { mock3id } = require('./mock3id')

class TestClient {
  constructor (ipfsOpts, pinningRoom) {
    const defaultIpfsOpts = {
      config: {
        Bootstrap: [],
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/4006',
            '/ip4/127.0.0.1/tcp/4007/ws'
          ]
        }
      }
    }
    this._ipfsConfig = defaultsDeep({}, ipfsOpts, defaultIpfsOpts)
    this._pinningRoom = pinningRoom
  }

  async init () {
    this._tmpDir = await tmp.dir({ unsafeCleanup: true })
    if (!this._ipfsConfig.repo) {
      this._ipfsConfig.repo = this._tmpDir.path + '/ipfs'
    }
    this.ipfs = await makeIPFS(this._ipfsConfig)
    this.identity = await Identities.createIdentity({
      type: '3ID',
      threeId: mock3id,
      identityKeysPath: this._tmpDir.path + '/odbIdentityKeys'
    })
    const ipfsId = await this.ipfs.id()
    this.orbitdb = await OrbitDB.createInstance(this.ipfs, {
      directory: this._tmpDir.path + '/orbitdb',
      identity: this.identity
    })
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
  }

  async stop () {
    await this.pubsub.disconnect()
    await this.orbitdb.stop()
    await this.ipfs.stop()
  }

  async cleanup () {
    await this.stop()
    await this._tmpDir.cleanup()
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

  onMsg () { }

  async createDB (withData) {
    const key = mock3id.getKeyringBySpaceName().getPublicKeys(true).signingKey
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
      for (const key in withData.public) {
        await this.pubStore.put(key, withData.public[key])
      }
      for (const key in withData.private) {
        await this.privStore.put(key, withData.private[key])
      }
    }
  }

  async dropDB () {
    await Promise.all([
      this.rootStore.drop(),
      this.pubStore.drop(),
      this.privStore.drop()
    ])
  }

  announceDB () {
    const rootStoreAddress = this.rootStore.address.toString()
    this.pubsub.subscribe(this._pinningRoom, (...args) => this.onMsg.apply(this, args), () => {
      this.pubsub.publish(this._pinningRoom, { type: 'PIN_DB', odbAddress: rootStoreAddress })
    })
  }

  async storeSynced ({ thread = false } = {}) {
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
        firstModerator: mock3id.DID,
        identity: this.identity
      }
    })
    if (withData) {
      for (const entry of withData) {
        await this.thread.add(entry)
      }
    }
  }

  async dropThread () {
    await this.thread.drop()
    await this.thread.close()
  }

  async announceThread () {
    const address = this.thread.address.toString()
    await this.pubsub.publish(this._pinningRoom, { type: 'SYNC_DB', odbAddress: address, thread: true })
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

  async getPrivate () {
    const priv = this.privStore.all
    const parsedProfile = {}
    Object.keys(priv).map(key => { parsedProfile[key] = priv[key].value })
    return parsedProfile
  }
}

module.exports = TestClient
