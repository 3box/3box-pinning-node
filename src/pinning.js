const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
const timer = require('exectimer')
const { resolveDID } = require('./util')
const orbitDBCache = require('orbit-db-cache-redis')

const TEN_MINUTES = 10 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000
const FORTY_FIVE_SECONDS = 45 * 1000
const NINETY_SECONDS = 2 * FORTY_FIVE_SECONDS
const PINNING_ROOM = '3box-pinning'
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

/**
  *  Pinning - a class for pinning orbitdb stores of 3box users
  */
class Pinning {
  constructor (cache, ipfsConfig, orbitdbPath, analytics, orbitCacheOpts, runCacheServiceOnly) {
    this.cache = cache
    this.ipfsConfig = ipfsConfig
    this.orbitdbPath = orbitdbPath
    this.openDBs = {}
    this.analytics = analytics
    this.orbitCacheOpts = orbitCacheOpts
    this.runCacheServiceOnly = runCacheServiceOnly
    this.dbOpenInterval = this.runCacheServiceOnly ? NINETY_SECONDS : THIRTY_MINUTES
    this.dbCheckCloseInterval = this.runCacheServiceOnly ? FORTY_FIVE_SECONDS : TEN_MINUTES
  }

  async start () {
    this.ipfs = await this._initIpfs()
    const ipfsId = await this.ipfs.id()
    console.log(ipfsId)
    const orbitOpts = this.orbitCacheOpts ? { cache: orbitDBCache(this.orbitCacheOpts) } : { }
    this.orbitdb = new OrbitDB(this.ipfs, this.orbitdbPath, orbitOpts)
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
              return entry.payload.value.odbAddress.split('.')[1] === 'public'
            })

          const profileFromPubStore = rejectOnError(reject, address => {
            const profile = this.openDBs[address].db.all()
            const parsedProfile = {}

            Object.entries(profile)
              .forEach(([k, v]) => {
                const timestamp = Math.floor(v.timeStamp / 1000)
                parsedProfile[k] = { value: v.value, timestamp }
              })

            resolve(parsedProfile)
          })

          this.openDB(profileEntry.payload.value.odbAddress, profileFromPubStore)
          this.analytics.trackGetProfile(address, !!profileFromPubStore)
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
            const name = entry.payload.value.odbAddress.split('.')[2]
            if (name) list.push(name)
            return list
          }, [])
        resolve(spaces)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, spacesFromRoot, this._openSubStores.bind(this))
      this.analytics.trackListSpaces(address)
    })
  }

  async getSpace (address, name) {
    return new Promise((resolve, reject) => {
      const spaceStoreFromRoot = address => {
        const spaceEntry = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .find(entry => {
            return entry.payload.value.odbAddress.split('.')[2] === name
          })

        const pubDataFromSpaceStore = address => {
          const pubSpace = this.openDBs[address].db.all()
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
        this.analytics.trackGetSpace(address, !!pubDataFromSpaceStore)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, spaceStoreFromRoot, this._openSubStores.bind(this))
    })
  }

  async getThread (name) {
    const address = (await this.orbitdb._determineAddress(name, 'eventlog', { write: ['*'] }, false)).toString()
    return new Promise((resolve, reject) => {
      const getThreadData = address => {
        const posts = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .map(entry => {
            let post = entry.payload.value
            post.postId = entry.hash
            return post
          })
        resolve(posts)
      }
      this.openDB(address, getThreadData)
      this.analytics.trackGetThread(address)
    })
  }

  async openDB (address, responseFn, onReplicatedFn, rootStoreAddress) {
    this.rewriteDBCache(address, rootStoreAddress)
    let tick = new timer.Tick('openDB')
    tick.start()
    if (!this.openDBs[address]) {
      console.log('Opening db:', address)
      const dbPromise = new Promise(async (resolve, reject) => {
        const db = await this.orbitdb.open(address)
        db.events.on('ready', () => {
          resolve(db)
        })
        db.load()
      })

      this.openDBs[address] = {
        dbPromise: dbPromise,
        latestTouch: Date.now(),
        loading: true
      }

      this.openDBs[address].db = await this.openDBs[address].dbPromise
      this.openDBs[address].loading = false
      responseFn(address)

      this.openDBs[address].db.events.on('replicated', () => {
        if (onReplicatedFn) onReplicatedFn(address)
        this.rewriteDBCache(address, rootStoreAddress)
      })
    } else {
      await this.openDBs[address].dbPromise
      responseFn(address)
    }
    tick.stop()
    this.analytics.trackOpenDB(address, timer.timers.openDB.duration())
  }

  async rewriteDBCache (odbAddress, rootStoreAddress) {
    const split = odbAddress.split('.')
    if (split[1] === 'space') {
      const spaceName = split[2]
      const space = await this.getSpace(rootStoreAddress, spaceName)
      this.cache.write(`${rootStoreAddress}_${spaceName}`, space)
    } else if (split[1] === 'public') {
      // the profile is only saved under the rootStoreAddress as key
      const profile = await this.getProfile(rootStoreAddress)
      this.cache.write(rootStoreAddress, profile)
    } else if (split[1] === 'root') {
      // in this case odbAddress is the rootStoreAddress
      const spaces = await this.listSpaces(rootStoreAddress)
      this.cache.write(`space-list_${odbAddress}`, spaces)
    } else if (split[1] === 'thread') {
      // thread cache is stored with the name of the DB
      const name = odbAddress.split('/')[3]
      const posts = await this.getThread(name)
      this.cache.write(name, posts)
    }
  }

  _sendHasResponse (address) {
    const numEntries = this.openDBs[address].db._oplog._length
    this._publish('HAS_ENTRIES', address, numEntries)
    // console.log('HAS_ENTRIES', address.split('.').pop(), numEntries)
  }

  _openSubStores (address) {
    if (this.runCacheServiceOnly) { return }
    const entries = this.openDBs[address].db.iterator({ limit: -1 }).collect()
    const uniqueEntries = entries.filter((e1, i, a) => {
      return a.findIndex(e2 => e2.payload.value.odbAddress === e1.payload.value.odbAddress) === i
    })
    uniqueEntries.map(entry => {
      const odbAddress = entry.payload.value.odbAddress
      if (odbAddress) {
        this.openDB(odbAddress, this._sendHasResponse.bind(this), null, address)
      }
    })
  }

  _openSubStoresAndSendHasResponse (address) {
    this._sendHasResponse(address)
    this._openSubStores(address)
  }

  _publish (type, odbAddress, data) {
    let dataObj = { type, odbAddress }
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
        this.openDB(data.odbAddress, this._openSubStoresAndSendHasResponse.bind(this), this._openSubStores.bind(this))
        this.analytics.trackPinDB(data.odbAddress)
      } else if (data.type === 'SYNC_DB' && data.thread) {
        this.openDB(data.odbAddress, this._sendHasResponse.bind(this))
      }
      if (data.did) {
        // We resolve the DID in order to pin the ipfs object
        try {
          resolveDID(this.ipfs, data.did)
          // if this throws it's not a DID
        } catch (e) {}
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
