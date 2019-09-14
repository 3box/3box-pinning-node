const IPFS = require('ipfs')
const { CID } = require('ipfs')
const OrbitDB = require('./orbit-db/OrbitDB.js')
const MessageBroker = require('./messageBroker')
const Pubsub = require('orbit-db-pubsub')
const timer = require('exectimer')
const { resolveDID } = require('./util')
const register3idResolver = require('3id-resolver')
const registerMuportResolver = require('muport-did-resolver')
const orbitDBCache = require('orbit-db-cache-redis')
const {
  OdbIdentityProvider,
  LegacyIPFS3BoxAccessController,
  ThreadAccessController,
  ModeratorAccessController
} = require('3box-orbitdb-plugins')
const Identities = require('orbit-db-identity-provider')
Identities.addIdentityProvider(OdbIdentityProvider)
const AccessControllers = require('orbit-db-access-controllers')
const IPFSLog = require('ipfs-log')
AccessControllers.addAccessController({ AccessController: LegacyIPFS3BoxAccessController })
AccessControllers.addAccessController({ AccessController: ThreadAccessController })
AccessControllers.addAccessController({ AccessController: ModeratorAccessController })

const TEN_MINUTES = 10 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000
const FORTY_FIVE_SECONDS = 45 * 1000
const NINETY_SECONDS = 2 * FORTY_FIVE_SECONDS
const PINNING_ROOM = '3box-pinning'
const rootEntryTypes = {
  SPACE: 'space',
  ADDRESS_LINK: 'address-link'
}
const IPFS_OPTIONS = {
  EXPERIMENTAL: {
    pubsub: true
  }
}

const rejectOnError = (reject, f) => {
  return (...args) => {
    try {
      return f(...args)
    } catch (e) {
      reject(e)
    }
  }
}

const pinDID = async did => {
  if (!did) return
  // We resolve the DID in order to pin the ipfs object
  try {
    await resolveDID(did)
    // if this throws it's not a DID
  } catch (e) {}
}

/**
  *  Pinning - a class for pinning orbitdb stores of 3box users
  */
class Pinning {
  constructor (cache, ipfsConfig, orbitdbPath, analytics, orbitCacheOpts, runCacheServiceOnly, pubSubConfig) {
    this.cache = cache
    this.ipfsConfig = ipfsConfig
    this.orbitdbPath = orbitdbPath
    this.openDBs = {}
    this.analytics = analytics
    this.orbitCacheOpts = orbitCacheOpts
    this.runCacheServiceOnly = runCacheServiceOnly
    this.pubSubConfig = pubSubConfig
    this.dbOpenInterval = this.runCacheServiceOnly ? NINETY_SECONDS : THIRTY_MINUTES
    this.dbCheckCloseInterval = this.runCacheServiceOnly ? FORTY_FIVE_SECONDS : TEN_MINUTES
  }

  async start () {
    this.ipfs = await this._initIpfs()
    register3idResolver(this.ipfs)
    registerMuportResolver(this.ipfs)
    const ipfsId = await this.ipfs.id()
    console.log(ipfsId)
    const orbitOpts = {
      directory: this.orbitdbPath
    }
    if (this.pubSubConfig) orbitOpts.broker = MessageBroker(this.pubSubConfig.instanceId, this.pubSubConfig.redis)
    if (this.orbitCacheOpts) {
      orbitOpts.cache = orbitDBCache(this.orbitCacheOpts)
    }
    this.orbitdb = await OrbitDB.createInstance(this.ipfs, orbitOpts)
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
    this.pubsub.subscribe(PINNING_ROOM, this._onMessage.bind(this), this._onNewPeer.bind(this))
    setInterval(this.checkAndCloseDBs.bind(this), this.dbCheckCloseInterval)
  }

  checkAndCloseDBs () {
    Object.keys(this.openDBs).map(async key => {
      if (Date.now() > this.openDBs[key].latestTouch + this.dbOpenInterval) {
        await this.dbClose(key)
      }
    })
  }

  async dbClose (address) {
    const entry = this.openDBs[address]
    if (entry) {
      if (!entry.loading) {
        const db = entry.db
        delete this.openDBs[address]
        await db.close()
      } else {
        // we should still close the DB even if we where not able to open it
        // otherwise we'll have a memory leak
        delete this.openDBs[address]
      }
    }
  }

  async getProfile (address) {
    return new Promise((resolve, reject) => {
      try {
        const pubStoreFromRoot = rejectOnError(reject, address => {
          const profileEntry = this.openDBs[address].db
            .iterator({ limit: -1 })
            .collect()
            .find(entry => {
              if (!entry.payload.value.odbAddress) return false
              return entry.payload.value.odbAddress.split('.')[1] === 'public'
            })

          const profileFromPubStore = rejectOnError(reject, address => {
            const profile = this.openDBs[address].db.all
            const parsedProfile = {}

            Object.entries(profile)
              .forEach(([k, v]) => {
                const timestamp = Math.floor(v.timeStamp / 1000)
                parsedProfile[k] = { value: v.value, timestamp }
              })

            resolve(parsedProfile)
          })

          this.openDB(profileEntry.payload.value.odbAddress, profileFromPubStore)
        })
        // we need to open substores on replicated, otherwise it will break
        // the auto pinning if the user adds another store to their root store
        this.openDB(address, pubStoreFromRoot, this._openSubStores.bind(this))
      } catch (e) {
        reject(e)
      }
    })
  }

  async listSpaces (address) {
    return new Promise((resolve, reject) => {
      const spacesFromRoot = address => {
        const spaces = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .reduce((list, entry) => {
            if (!entry.payload.value.odbAddress) return list
            const name = entry.payload.value.odbAddress.split('.')[2]
            if (name) list.push(name)
            return list
          }, [])
        resolve(spaces)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, spacesFromRoot, this._openSubStores.bind(this))
    })
  }

  async getConfig (address) {
    return new Promise((resolve, reject) => {
      const spacesFromRoot = async address => {
        const config = await this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .reduce(async (conf, entry) => {
            conf = await conf
            const value = entry.payload.value
            if (value.type === rootEntryTypes.SPACE) {
              if (!conf.spaces) conf.spaces = {}
              const name = value.odbAddress.split('.')[2]
              conf.spaces[name] = {
                DID: value.DID
              }
            } else if (value.type === rootEntryTypes.ADDRESS_LINK) {
              if (!conf.links) conf.links = []
              const obj = (await this.ipfs.dag.get(value.data)).value
              conf.links.push(obj)
            }
            return conf
          }, Promise.resolve({}))
        resolve(config)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, spacesFromRoot, this._openSubStores.bind(this))
    })
  }

  async getSpace (address, name) {
    return new Promise((resolve, reject) => {
      const spaceStoreFromRoot = address => {
        const spaceEntry = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .find(entry => {
            if (!entry.payload.value.odbAddress) return false
            return entry.payload.value.odbAddress.split('.')[2] === name
          })

        const pubDataFromSpaceStore = address => {
          const pubSpace = this.openDBs[address].db.all
          const parsedSpace = Object.keys(pubSpace).reduce((obj, key) => {
            if (key.startsWith('pub_')) {
              const x = pubSpace[key]
              const timestamp = Math.floor(x.timeStamp / 1000)
              obj[key.slice(4)] = { value: x.value, timestamp }
            }
            return obj
          }, {})
          resolve(parsedSpace)
        }
        if (spaceEntry) {
          this.openDB(spaceEntry.payload.value.odbAddress, pubDataFromSpaceStore)
        } else {
          resolve({})
        }
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, spaceStoreFromRoot, this._openSubStores.bind(this))
    })
  }

  async getThreadAddress (name, firstModerator, members) {
    return (await this.orbitdb._determineAddress(name, 'feed', {
      accessController: {
        type: 'thread-access',
        threadName: name,
        members,
        firstModerator
      }
    }, false)).toString()
  }

  async getThread (address) {
    return new Promise((resolve, reject) => {
      const getThreadData = address => {
        const posts = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .map(entry => {
            const post = Object.assign({ postId: entry.hash }, entry.payload.value)
            return post
          })
        resolve(posts)
      }
      this.openDB(address, getThreadData)
    })
  }

  async openDB (address, responseFn, onReplicatedFn, rootStoreAddress, analyticsFn) {
    const tick = new timer.Tick('openDB')
    tick.start()
    let root, did

    if (!this.openDBs[address]) {
      console.log('Opening db:', address)
      this.openDBs[address] = {
        dbPromise: new Promise((resolve, reject) => {
          const cid = new CID(address.split('/')[2])

          const opts = {
            syncLocal: true,
            sortFn: IPFSLog.Sorting.SortByEntryHash, // this option is required now but will likely not be in the future.
            accessController: {
              type: 'legacy-ipfs-3box',
              skipManifest: true
            }
          }
          this.orbitdb.open(address, cid.version === 0 ? opts : {}).then(db => {
            db.events.on('ready', () => {
              resolve(db)
            })
            db.load()
          })
        })
      }
      this.openDBs[address].latestTouch = Date.now()
      this.openDBs[address].loading = true

      this.openDBs[address].db = await this.openDBs[address].dbPromise
      this.openDBs[address].loading = false
      responseFn(address)

      root = address.split('.')[1] === 'root' ? address : rootStoreAddress
      did = root ? await this.rootStoreToDID(root) : null
      if (analyticsFn && did) analyticsFn(did, false)

      this.openDBs[address].db.events.on('replicated', async () => {
        if (onReplicatedFn) onReplicatedFn(address)
        if (!did) {
          did = root ? await this.rootStoreToDID(root) : null
          if (analyticsFn && did) analyticsFn(did, true)
        }
        this.rewriteDBCache(address, rootStoreAddress, did)
      })
    } else {
      await this.openDBs[address].dbPromise
      responseFn(address)
      if (analyticsFn) {
        root = address.split('.')[1] === 'root' ? address : rootStoreAddress
        did = root ? await this.rootStoreToDID(root) : null
        analyticsFn(did, false)
      }
    }
    tick.stop()
  }

  async rootStoreToDID (rootStoreAddress) {
    try {
      const linkEntry = await this.openDBs[rootStoreAddress].db
        .iterator({ limit: -1 })
        .collect()
        .find(e => {
          const value = e.payload.value
          return value.type === rootEntryTypes.ADDRESS_LINK
        })
      if (!linkEntry) return null
      const linkAddress = linkEntry.payload.value.data
      const link = (await this.ipfs.dag.get(linkAddress)).value
      const did = /\bdid:.*\b/g.exec(link.message)[0]
      return did
    } catch (e) {
      return null
    }
  }

  async rewriteDBCache (odbAddress, rootStoreAddress, did) {
    const split = odbAddress.split('.')
    if (split[1] === 'space') {
      const spaceName = split[2]
      const space = await this.getSpace(rootStoreAddress, spaceName)
      this.cache.write(`${rootStoreAddress}_${spaceName}`, space)
      this.analytics.trackSpaceUpdate(odbAddress, spaceName, did)
    } else if (split[1] === 'public') {
      // the profile is only saved under the rootStoreAddress as key
      const profile = await this.getProfile(rootStoreAddress)
      this.cache.write(rootStoreAddress, profile)
      this.analytics.trackPublicUpdate(odbAddress, did)
    } else if (split[1] === 'root') {
      // in this case odbAddress is the rootStoreAddress
      const spaces = await this.listSpaces(odbAddress)
      this.cache.write(`space-list_${odbAddress}`, spaces)
      const config = await this.getConfig(odbAddress)
      this.cache.write(`config_${odbAddress}`, config)
      this.analytics.trackRootUpdate(did)
    } else if (split[1] === 'thread') {
      // thread cache is stored with the name of the DB
      const posts = await this.getThread(odbAddress)
      this.cache.write(odbAddress, posts)
      const threadName = split[2]
      const threadSpace = split[3]
      this.analytics.trackThreadUpdate(odbAddress, threadSpace, threadName)
    } else if (split[1] === 'private') {
      this.analytics.trackPrivateUpdate(odbAddress, did)
    }
  }

  _sendHasResponse (address) {
    const numEntries = this.openDBs[address].db._oplog.values.length
    this._publish('HAS_ENTRIES', address, numEntries)
  }

  _openSubStores (address) {
    if (this.runCacheServiceOnly) { return }
    const entries = this.openDBs[address].db.iterator({ limit: -1 }).collect().filter(e => Boolean(e.payload.value.odbAddress))
    const uniqueEntries = entries.filter((e1, i, a) => {
      return a.findIndex(e2 => e2.payload.value.odbAddress === e1.payload.value.odbAddress) === i
    })
    uniqueEntries.map(entry => {
      const data = entry.payload.value
      if (data.type === rootEntryTypes.SPACE) {
        // don't open db if the space entry is malformed
        if (!data.DID || !data.odbAddress) return
        pinDID(data.DID)
      }
      if (data.odbAddress) {
        this.openDB(data.odbAddress, this._sendHasResponse.bind(this), null, address)
      }
    })

    this._pinLinkAddressProofs(address)
  }

  _pinLinkAddressProofs (address) {
    // assuming address is root store
    const entries = this.openDBs[address].db.iterator({ limit: -1 }).collect()
    // Filter for address-links, get CID, and get to pin it
    entries.filter(e => e.payload.value.type === 'address-link')
      .map(e => { this.ipfs.dag.get(e.payload.value.data) })
  }

  _openSubStoresAndSendHasResponse (address) {
    this._sendHasResponse(address)
    this._openSubStores(address)
  }

  _publish (type, odbAddress, data) {
    const dataObj = { type, odbAddress }
    if (type === 'HAS_ENTRIES') {
      dataObj.numEntries = data
    } else if (type === 'REPLICATED') {
    }
    this.pubsub.publish(PINNING_ROOM, dataObj)
  }

  _onMessage (topic, data) {
    console.log(topic, data)
    if (OrbitDB.isValidAddress(data.odbAddress)) {
      if (data.type === 'PIN_DB') {
        this.openDB(data.odbAddress, this._openSubStoresAndSendHasResponse.bind(this), this._openSubStores.bind(this), null, this.analytics.trackPinDB.bind(this.analytics))
        this.analytics.trackPinDBAddress(data.odbAddress)
      } else if (data.type === 'SYNC_DB' && data.thread) {
        this.openDB(data.odbAddress, this._sendHasResponse.bind(this))
        this.analytics.trackSyncDB(data.odbAddress)
      }
      if (data.did) {
        pinDID(data.did)
      }
    }
  }

  _onNewPeer (topic, peer) {
    console.log('peer joined room', topic, peer)
  }

  async _initIpfs () {
    // Create IPFS instance
    const config = { ...IPFS_OPTIONS, ...this.ipfsConfig }
    const ipfs = new IPFS(config)
    return new Promise((resolve, reject) => {
      ipfs.on('error', (e) => console.error(e))
      ipfs.on('ready', () => resolve(ipfs))
    })
  }
}

module.exports = Pinning
