const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')

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
  constructor (cache, ipfsPath, orbitdbPath) {
    this.cache = cache
    this.ipfsPath = ipfsPath
    this.orbitdbPath = orbitdbPath
    this.openDBs = {}
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
          let parsedProfile = {}
          Object.keys(profile).map(key => { parsedProfile[key] = profile[key].value })
          resolve(parsedProfile)
        }
        this.openDB(profileEntry.payload.value.odbAddress, profileFromPubStore)
      }
      // we need to open substores on replicated, otherwise it will break
      // the auto pinning if the user adds another store to their root store
      this.openDB(address, pubStoreFromRoot, this._openSubStores.bind(this))
    })
  }

  async openDB (address, responseFn, onReplicatedFn) {
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
      this.openDBs[address].db.events.on(
        'replicate.progress',
        (odbAddress, entryHash, entry, num, max) => {
          this.openDBs[address].latestTouch = Date.now()
          //console.log('Replicating entry:', entryHash, entry, '\n', 'On db:', odbAddress)
            console.log('numax', num, max)
          if (num === max && odbAddress === entry.id) {
            this.openDBs[address].db.events.on('replicated', () => {
              console.log('Fully replicated db:', odbAddress)
              //this._publish('REPLICATED', address)
              if (onReplicatedFn) onReplicatedFn(address)
            })
          }
        }
      )
    } else {
      if (this.openDBs[address].dbPromise) {
        await this.openDBs[address].dbPromise
      }
      responseFn(address)
    }
  }

  _sendHasResponse (address) {
    const numEntries = this.openDBs[address].db._oplog._length
    this._publish('HAS_ENTRIES', address, numEntries)
    console.log('HAS_ENTRIES', address.split('.').pop(), numEntries)
  }

  _openSubStores (address) {
    this.openDBs[address].db.iterator({ limit: -1 }).collect().map(entry => {
      const odbAddress = entry.payload.value.odbAddress
      console.log('sub entry', odbAddress)
      //if (odbAddress.split('.').pop() === 'public') {
        this.openDB(odbAddress, this._sendHasResponse.bind(this))
      //}
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
    if (!data.type || data.type === 'PIN_DB') {
      this.openDB(data.odbAddress, this._openSubStoresAndSendHasResponse.bind(this), this._openSubStores.bind(this))
      //this.openDB(data.odbAddress, () => {})//this._openSubStoresAndSendHasResponse.bind(this), this._openSubStores.bind(this))
      this.cache.invalidate(data.odbAddress)
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
