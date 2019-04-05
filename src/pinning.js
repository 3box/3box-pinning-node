const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
const timer = require('exectimer')
const { resolveDID } = require('./util')

const TEN_MINUTES = 10 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000
const PINNING_ROOM = '3box-pinning'
const IPFS_OPTIONS = {
  EXPERIMENTAL: {
    pubsub: true
  }
}

/**
  *  Pinning - a class for pinning orbitdb stores of 3box users
  */
class Pinning {
  constructor (cache, ipfsPath, orbitdbPath, analytics) {
    this.cache = cache
    this.ipfsPath = ipfsPath
    this.orbitdbPath = orbitdbPath
    this.openDBs = {}
    this.analytics = analytics
  }

  async start () {
    this.ipfs = await this._initIpfs()
    const ipfsId = await this.ipfs.id()
    console.log(ipfsId)
    this.orbitdb = new OrbitDB(this.ipfs, this.orbitdbPath)
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id)
    this.pubsub.subscribe(PINNING_ROOM, this._onMessage.bind(this), this._onNewPeer.bind(this))
    // close stores after 30 min check every 10 min
    setInterval(this.checkAndCloseDBs.bind(this), TEN_MINUTES)
  }

  checkAndCloseDBs () {
    Object.keys(this.openDBs).map(async key => {
      if (Date.now() > this.openDBs[key].latestTouch + THIRTY_MINUTES) {
        const db = this.openDBs[key].db
        delete this.openDBs[key]
        await db.close()
      }
    })
  }

  async getProfile (address) {
    return new Promise((resolve, reject) => {
      const pubStoreFromRoot = address => {
        const profileEntry = this.openDBs[address].db
          .iterator({ limit: -1 })
          .collect()
          .find(entry => {
            return entry.payload.value.odbAddress.split('.')[1] === 'public'
          })
        const profileFromPubStore = address => {
          const profile = this.openDBs[address].db.all()
          const parsedProfile = {}

          Object.entries(profile)
            .forEach(([k, v]) => {
              parsedProfile[k] = { value: v.value, timestamp: v.timeStamp }
            })

          resolve(parsedProfile)
        }
        this.openDB(profileEntry.payload.value.odbAddress, profileFromPubStore)
        this.analytics.trackGetProfile(address, !!profileFromPubStore)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, pubStoreFromRoot, this._openSubStores.bind(this))
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
              obj[key.slice(4)] = { value: x.value, timestamp: x.timeStamp }
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
    this.invalidateDBCache(address, rootStoreAddress)
    let tick = new timer.Tick('openDB')
    tick.start()
    if (!this.openDBs[address]) {
      console.log('Opening db:', address)
      this.openDBs[address] = {
        dbPromise: this.orbitdb.open(address),
        latestTouch: Date.now()
      }
      this.openDBs[address].db = await this.openDBs[address].dbPromise
      delete this.openDBs[address].dbPromise
      this.openDBs[address].db.events.on('ready', () => {
        responseFn(address)
      })
      this.openDBs[address].db.load()
      this.openDBs[address].db.events.on('replicated', () => {
        if (onReplicatedFn) onReplicatedFn(address)
        this.invalidateDBCache(address, rootStoreAddress)
      })
    } else {
      if (!this.openDBs[address].dbPromise) {
        // We don't need to call the responseFn if there is a promise present
        // as it will get called anyway
        responseFn(address)
      }
    }
    tick.stop()
    this.analytics.trackOpenDB(address, timer.timers.openDB.duration())
  }

  invalidateDBCache (odbAddress, rootStoreAddress) {
    const split = odbAddress.split('.')
    if (split[1] === 'space') {
      const spaceName = split[2]
      this.cache.invalidate(`${rootStoreAddress}_${spaceName}`)
    } else if (split[1] === 'public') {
      // the profile is only saved under the rootStoreAddress as key
      this.cache.invalidate(`${rootStoreAddress}`)
    } else if (split[1] === 'root') {
      // in this case odbAddress is the rootStoreAddress
      this.cache.invalidate(`space-list_${odbAddress}`)
    } else if (split[1] === 'thread') {
      // thread cache is stored with the name of the DB
      this.cache.invalidate(odbAddress.split('/')[3])
    }
  }

  _sendHasResponse (address) {
    const numEntries = this.openDBs[address].db._oplog._length
    this._publish('HAS_ENTRIES', address, numEntries)
    // console.log('HAS_ENTRIES', address.split('.').pop(), numEntries)
  }

  _openSubStores (address) {
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
    let ipfsOpts = IPFS_OPTIONS
    if (this.ipfsPath) ipfsOpts.repo = this.ipfsPath
    const ipfs = new IPFS(ipfsOpts)
    return new Promise((resolve, reject) => {
      ipfs.on('error', (e) => console.error(e))
      ipfs.on('ready', () => resolve(ipfs))
    })
  }
}

module.exports = Pinning
