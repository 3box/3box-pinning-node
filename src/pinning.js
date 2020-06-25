const { CID } = require('ipfs')
const OrbitDB = require('orbit-db')
const MessageBroker = require('./messageBroker')
const Pubsub = require('orbit-db-pubsub')
const timer = require('exectimer')
const { Resolver } = require('did-resolver')
const get3IdResolver = require('3id-resolver').getResolver
const getMuportResolver = require('muport-did-resolver').getResolver
const OrbitDBCache = require('orbit-db-cache-redis')
const EntriesCache = require('./hasEntriesCache')
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
const { createLogger } = require('./logger')

AccessControllers.addAccessController({ AccessController: LegacyIPFS3BoxAccessController })
AccessControllers.addAccessController({ AccessController: ThreadAccessController })
AccessControllers.addAccessController({ AccessController: ModeratorAccessController })

const manifestCacheKey = address => `${address}/_manifest`

// const IPFS_METRICS_ENABLED = process.env.IPFS_METRICS_ENABLED || true
const IPFS_METRICS_ENABLED = false
const IPFS_METRICS_INTERVAL = process.env.IPFS_METRICS_INTERVAL || 10000

const memwatch = require('node-memwatch')

class MemoryInspector {
  constructor () {
    memwatch.on('leak', (info) => {
      console.log(JSON.stringify(info, null, 2))
    })
  }

  start () {
    setInterval(() => {
      console.log('Taking first snapshot...')
      const hd = new memwatch.HeapDiff()

      const timerId = setTimeout(() => {
        console.log('Taking second snapshot...')
        const diff = hd.end()
        console.log(JSON.stringify(diff, null, 2))
        clearTimeout(timerId)
      }, 180000) // 3 minutes
    }, 600000) // 10 minutes
  }
}

// A temporary fix for issues described here - https://github.com/orbitdb/orbit-db/pull/688
// Once a permant fix is merged into orbitdb and we upgrade, we no longer need the
// fix implemented below.
class OrbitDB3Box extends OrbitDB {
  // wrap to return OrbitDB3Box instead of OrbitDB instance
  static async createInstance (ipfs, options = {}) {
    const orbitdb = await super.createInstance(ipfs, options)

    options = Object.assign({}, options, {
      peerId: orbitdb.id,
      directory: orbitdb.directory,
      keystore: orbitdb.keystore
    })

    return new OrbitDB3Box(orbitdb._ipfs, orbitdb.identity, options)
  }

  // register ready listener/state on creation
  async _createStore (type, address, options) {
    const store = await super._createStore(type, address, options)
    this.stores[address.toString()].ready = new Promise(resolve => { store.events.on('ready', resolve) })
    return store
  }

  // block message consumption until ready
  async _onMessage (address, heads) {
    await this.stores[address].ready
    super._onMessage(address, heads)
  }
}

const TEN_MINUTES = 10 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000
const rootEntryTypes = {
  SPACE: 'space',
  ADDRESS_LINK: 'address-link'
}

/**
  *  Pinning - a class for pinning orbitdb stores of 3box users
  */
class Pinning {
  constructor (ipfs, orbitdbPath, analytics, orbitCacheOpts, pubSubConfig, pinningRoom, entriesNumCacheOpts, pinWhitelistDids, pinWhitelistSpaces, pinSilent) {
    this.ipfs = ipfs
    this.orbitdbPath = orbitdbPath
    this.openDBs = {}
    this.analytics = analytics
    this.orbitCacheOpts = orbitCacheOpts
    this.pubSubConfig = pubSubConfig
    this.pinningRoom = pinningRoom
    this.entriesNumCacheOpts = entriesNumCacheOpts
    this.dbOpenInterval = THIRTY_MINUTES
    this.dbCheckCloseInterval = TEN_MINUTES
    this.pinWhitelistDids = pinWhitelistDids
    this.pinWhitelistSpaces = pinWhitelistSpaces
    this.pinSilent = pinSilent
    this.logger = createLogger({ name: 'pinning' })
  }

  async start () {
    const ipfsId = await this.ipfs.id()
    const threeIdResolver = get3IdResolver(this.ipfs)
    const muportResolver = getMuportResolver(this.ipfs)
    this._resolver = new Resolver({ ...threeIdResolver, ...muportResolver })
    OdbIdentityProvider.setDidResolver(this._resolver)

    this._pinningResolver = new Resolver({
      ...get3IdResolver(this.ipfs, { pin: true }),
      ...getMuportResolver(this.ipfs)
    })

    this.logger.info('ipfsId', ipfsId)

    const orbitOpts = {
      directory: this.orbitdbPath
    }
    if (this.orbitCacheOpts) {
      orbitOpts.cache = new OrbitDBCache(this.orbitCacheOpts)
    }

    this.entriesCache = new EntriesCache(this.entriesNumCacheOpts)

    // Identity not used, passes ref to 3ID orbit identity provider
    orbitOpts.identity = await Identities.createIdentity({ id: 'nullid' })

    this.orbitdb = await OrbitDB3Box.createInstance(this.ipfs, orbitOpts)
    if (this.pubSubConfig) {
      const orbitOnMessage = this.orbitdb._onMessage.bind(this.orbitdb)
      const messageBroker = new MessageBroker(this.orbitdb._ipfs, this.orbitdb.id, this.pubSubConfig.instanceId, this.pubSubConfig.redis, orbitOnMessage)
      this.orbitdb._pubsub = messageBroker
      this.orbitdb._onMessage = messageBroker.onMessageWrap.bind(messageBroker)
    }
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
    await this.pubsub.subscribe(this.pinningRoom, this._onMessage.bind(this), this._onNewPeer.bind(this))
    this._dbCloseinterval = setInterval(this.checkAndCloseDBs.bind(this), this.dbCheckCloseInterval)

    if (IPFS_METRICS_ENABLED) {
      // Log out the bandwidth stats periodically
      this._ipfsMetricsInterval = setInterval(async () => {
        try {
          let stats = this.ipfs.libp2p.metrics.global
          this.logger.info(`Bandwith Stats: ${JSON.stringify(stats)}`)

          stats = await this.ipfs.stats.bitswap()
          this.logger.info(`Bitswap Stats: ${JSON.stringify(stats)}`)

          stats = await this.ipfs.stats.repo()
          this.logger.info(`Repo Stats: ${JSON.stringify(stats)}`)
        } catch (err) {
          this.logger.error(`Error occurred trying to check node stats: ${err}`)
        }
      }, IPFS_METRICS_INTERVAL)
    }

    const memoryInspector = new MemoryInspector()
    memoryInspector.start()
  }

  async stop () {
    clearInterval(this._dbCloseinterval)

    if (IPFS_METRICS_ENABLED) {
      clearInterval(this._ipfsMetricsInterval)
    }

    await this.pubsub.disconnect()
    await this.checkAndCloseDBs()
    await this.orbitdb.stop()
    await this.ipfs.stop()
  }

  async checkAndCloseDBs () {
    try {
      await Promise.all(Object.keys(this.openDBs).map(async key => {
        if (Date.now() > this.openDBs[key].latestTouch + this.dbOpenInterval) {
          await this.dbClose(key)
        }
      }))
    } catch (e) {
      this.logger.error(`Error occurred trying to close dbs: ${e}`)
    }
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

  async openDB (address, responseFn, onReplicatedFn, rootStoreAddress, analyticsFn) {
    const tick = new timer.Tick('openDB')
    tick.start()
    let root, did

    if (!this.openDBs[address]) {
      this.logger.info('Opening db:', address)

      this.openDBs[address] = {
        dbPromise: new Promise((resolve, reject) => {
          const cid = new CID(address.split('/')[2])

          const opts = {
            syncLocal: true,
            sortFn: IPFSLog.Sorting.SortByEntryHash, // this option is required now but will likely not be in the future.
            accessController: {
              type: 'legacy-ipfs-3box',
              skipManifest: true,
              resolver: this._resolver
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
        this._cacheNumEntries(address)
        this.trackUpdates(address, rootStoreAddress, did)
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

  async trackUpdates (odbAddress, rootStoreAddress, did) {
    const split = odbAddress.split('.')
    if (split[1] === 'space') {
      const spaceName = split[2]
      this.analytics.trackSpaceUpdate(odbAddress, spaceName, did)
    } else if (split[1] === 'public') {
      this.analytics.trackPublicUpdate(odbAddress, did)
    } else if (split[1] === 'root') {
      this.analytics.trackRootUpdate(did)
    } else if (split[1] === 'thread') {
      const threadName = split[2]
      const threadSpace = split[3]
      this.analytics.trackThreadUpdate(odbAddress, threadSpace, threadName)
    } else if (split[1] === 'private') {
      this.analytics.trackPrivateUpdate(odbAddress, did)
    }
  }

  _shouldHandlePinRequest (pinRequestMessage) {
    return !this.pinWhitelistDids || (pinRequestMessage && this.pinWhitelistDids.includes(pinRequestMessage.did))
  }

  _shouldPinSpace (rootEntry) {
    const spaceName = rootEntry.odbAddress.split('.')[2]
    return !this.pinWhitelistSpaces || (this.pinWhitelistSpaces.includes(spaceName))
  }

  _shouldSyncThread (syncRequestMessage) {
    const spaceName = syncRequestMessage.odbAddress.split('.')[3]
    return !this.pinWhitelistSpaces || (this.pinWhitelistSpaces.includes(spaceName))
  }

  async _sendHasResponse (address, numEntries) {
    if (this.pinSilent) {
      return
    }

    const cacheEntries = typeof numEntries === 'number' ? numEntries : await this.entriesCache.get(address)

    // line can be removed in future
    // if (typeof cacheEntries !== 'number' && await this._dbOpenedBefore(address)) return
    await this._publish('HAS_ENTRIES', address, cacheEntries || 0)
  }

  async _dbOpenedBefore (address) {
    const val = await this.orbitdb.cache.get(manifestCacheKey(address))
    return Boolean(val)
  }

  async _cacheNumEntries (address) {
    const numEntries = this.openDBs[address].db._oplog.values.length
    // 2 lines can be removed in future
    // const notCachedBefore = await this.entriesCache.get(address) === null
    // if (notCachedBefore) this._sendHasResponse(address, numEntries)

    this.entriesCache.set(address, numEntries)
  }

  _openSubStores (address) {
    const entries = this.openDBs[address].db.iterator({ limit: -1 }).collect().filter(e => Boolean(e.payload.value.odbAddress))
    const uniqueEntries = entries.filter((e1, i, a) => {
      return a.findIndex(e2 => e2.payload.value.odbAddress === e1.payload.value.odbAddress) === i
    })
    uniqueEntries.map(entry => {
      const data = entry.payload.value
      if (data.type === rootEntryTypes.SPACE) {
        // don't open db if the space entry is malformed
        if (!data.DID || !data.odbAddress) return
        if (!this._shouldPinSpace(data)) return
        this._pinDID(data.DID)
      }
      if (data.odbAddress) {
        this._sendHasResponse(data.odbAddress)
        this.openDB(data.odbAddress, this._cacheNumEntries.bind(this), null, address)
      }
    })

    this._pinLinkAddressProofs(address)
  }

  _pinLinkAddressProofs (address) {
    // assuming address is root store
    const entries = this.openDBs[address].db.iterator({ limit: -1 }).collect()
    // Filter for address-links, get CID, and get to pin it
    const filter = e => e.payload.value.type === 'address-link' || e.payload.value.type === 'auth-data'
    entries.filter(filter).forEach(async e => {
      const cid = e.payload.value.data
      await this.ipfs.dag.get(cid)
      this.ipfs.pin.add(cid)
    })
  }

  async _pinDID (did) {
    if (!did) return
    // We resolve the DID in order to pin the ipfs object
    try {
      await this._pinningResolver.resolve(did)
      // if this throws it's not a DID
    } catch (e) {}
  }

  _openSubStoresAndCacheEntries (address) {
    this._cacheNumEntries(address)
    this._openSubStores(address)
  }

  async _publish (type, odbAddress, data) {
    const dataObj = { type, odbAddress }
    if (type === 'HAS_ENTRIES') {
      dataObj.numEntries = data
    } else if (type === 'REPLICATED') {
    }
    this.pubsub.publish(this.pinningRoom, dataObj)
  }

  _onMessage (topic, data) {
    if (OrbitDB.isValidAddress(data.odbAddress)) {
      this._sendHasResponse(data.odbAddress)
      if (data.type === 'PIN_DB' && this._shouldHandlePinRequest(data)) {
        this.openDB(data.odbAddress, this._openSubStoresAndCacheEntries.bind(this), this._openSubStores.bind(this), null, this.analytics.trackPinDB.bind(this.analytics))
        this.analytics.trackPinDBAddress(data.odbAddress)
      } else if (data.type === 'SYNC_DB' && data.thread && this._shouldSyncThread(data)) {
        this.openDB(data.odbAddress, this._cacheNumEntries.bind(this))
        this.analytics.trackSyncDB(data.odbAddress)
      }
      if (data.did) {
        this._pinDID(data.did)
      }
      if (data.muportDID) {
        this._pinDID(data.muportDID)
      }
    }
  }

  _onNewPeer (topic, peer) {
    this.logger.info('peer joined room', topic, peer)
  }
}

module.exports = Pinning
