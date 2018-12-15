#!/usr/bin/env node

require('dotenv').config()
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
const DaemonFactory = require('ipfsd-ctl')
const fs = require('fs')
const express = require("express");
const RedisCache = require('./cache')
const axios = require('axios');

const ADDRESS_SERVER_URL = 'https://beta.3box.io/address-server'
const ORBITDB_PATH = '/opt/orbitdb'
const IPFS_PATH = '/opt/ipfs'
const PINNING_ROOM = '3box-pinning'
//TODO move to to env configs
const REDIS_PATH = 'profilecache.h9luwi.0001.usw2.cache.amazonaws.com'

const days15 = 60 * 60 * 24 * 15   // 15 day ttl
const cache = new RedisCache({ host: REDIS_PATH }, days15)
// const cache = new RedisCache()

let openDBs = {}

async function startIpfsDaemon () {
  // ipfsd-ctl creates a weird 'api' file, it won't start the node if it's present
  // https://github.com/ipfs/js-ipfsd-ctl/issues/226
  await new Promise((resolve, reject) => { fs.unlink(IPFS_PATH + '/api', resolve) })
  return new Promise((resolve, reject) => {
    DaemonFactory
      .create({ type: 'js' })
      .spawn({ disposable: false, repoPath: IPFS_PATH, defaultAddrs: true }, async (err, ipfsd) => {
        if (err) reject(err)
        // init repo if not initialized
        await new Promise((resolve, reject) => { ipfsd.init(resolve) })
        // start the daemon
        await new Promise((resolve, reject) => {
          ipfsd.start(['--enable-pubsub-experiment'], (err) => {
            if (err) reject(err)
            resolve()
          })
        })
        resolve(ipfsd.api)
      })
  })
}


// TODO just move starting ipfs and orbitdb to another function
let orbitdb, ipfs

async function pinningNode () {
  ipfs = await startIpfsDaemon()
  console.log(await ipfs.id())
  orbitdb = new OrbitDB(ipfs, ORBITDB_PATH)
  const pubsub = new Pubsub(ipfs, (await ipfs.id()).id)

  pubsub.subscribe(PINNING_ROOM, onMessage, onNewPeer)

  async function openRootDB (address) {

    if (!openDBs[address]) {
      openDBs[address] = await orbitdb.open(address)
      openDBs[address].events.on('ready', () => {
        openStoresAndSendResponse()
      })
      openDBs[address].load()

      openDBs[address].events.on(
        'replicate.progress',
        (odbAddress, entryHash, entry, num, max) => {
          openDB(entry.payload.value.odbAddress)
          console.log('Replicating entry:', entryHash)
          console.log('On db:', odbAddress)
          if (num === max) {
            openDBs[address].events.on('replicated', () => {
              console.log('Fully replicated db:', odbAddress)
              publish('REPLICATED', address)
            })
          }
        }
      )
    } else {
      openStoresAndSendResponse()
    }

    function openStoresAndSendResponse () {
      const numEntries = openDBs[address]._oplog._length
      publish('HAS_ENTRIES', address, numEntries)
      openDBs[address].iterator({ limit: -1 }).collect().map(entry => {
        const odbAddress = entry.payload.value.odbAddress
        openDB(odbAddress)
      })
    }

    cache.invalidate(address)
  }

  async function openDB (address) {
    if (!openDBs[address]) {
      console.log('Opening db:', address)
      openDBs[address] = await orbitdb.open(address)
      openDBs[address].events.on('ready', () => {
        sendResponse()
      })
      openDBs[address].load()
      openDBs[address].events.on(
        'replicate.progress',
        (odbAddress, entryHash, entry, num, max) => {
          console.log('Replicating entry:', entryHash)
          console.log('On db:', odbAddress)
          if (num === max) {
            openDBs[address].events.on('replicated', () => {
              console.log('Fully replicated db:', odbAddress)
              publish('REPLICATED', address)
            })
          }
        }
      )
    } else {
      sendResponse()
    }

    function sendResponse () {
      const numEntries = openDBs[address]._oplog._length
      publish('HAS_ENTRIES', address, numEntries)
    }
  }

  function publish (type, odbAddress, data) {
    let dataObj = { type, odbAddress }
    if (type === 'HAS_ENTRIES') {
      dataObj.numEntries = data
    } else if (type === 'REPLICATED') {
    }
    pubsub.publish(PINNING_ROOM, dataObj)
  }

  async function onMessage (topic, data) {
    console.log(topic, data)
    if (!data.type || data.type === 'PIN_DB') {
      openRootDB(data.odbAddress)
    }
  }

  async function onNewPeer (topic, peer) {
    console.log('peer joined room', topic, peer)
  }
}

pinningNode()


/*********************
 *    Profile API    *
 *********************/

const getProfile = async (rootStoreAddress) => {
  const rootStore = await orbitdb.open(rootStoreAddress)
  const readyPromise = new Promise((resolve, reject) => {
    rootStore.events.on('ready', resolve)
  })
  rootStore.load()
  await readyPromise

  await Promise.resolve(resolve => {
    rootStore.events.on('replicated', resolve)
  })

  const profileEntry = rootStore
    .iterator({ limit: -1 })
    .collect()
    .find(entry => {
      return entry.payload.value.odbAddress.split('.')[1] === 'public'
    })

  const publicStore = await orbitdb.open(profileEntry.payload.value.odbAddress)
  const readyPromisePublic = new Promise((resolve, reject) => {
    publicStore.events.on('ready', resolve)
  })
  publicStore.load()
  await readyPromisePublic
  await Promise.resolve(resolve => {
    publicStore.events.on('replicated', resolve)
  })

  const profile = publicStore.all()

  await rootStore.close()
  await publicStore.close()

  let parsedProfile = {}
  Object.keys(profile).map(key => { parsedProfile[key] = profile[key].value })
  return parsedProfile
}

const app = express()
app.use(express.json())

app.get("/profile", async (req, res, next) => {
  const address = req.query.address.toLowerCase()
  const request = `${ADDRESS_SERVER_URL}/odbAddress/${address}`
  const getRes = await axios.get(request)
  const rootStoreAddress = getRes.data.data.rootStoreAddress
  const cacheProfile = await cache.read(rootStoreAddress)
  const profile = cacheProfile || await getProfile(rootStoreAddress)
  res.json(profile)
  if (!cacheProfile) cache.write(rootStoreAddress, profile)
});

// TODO return {address: profile} or return array of [{address: profile}].
// Request body of form { addressList: ['address1', 'address2', ...]}
app.post("/profileList", async (req, res, next) => {
  const body = req.body
  if (!body.addressList) res.status(500).send('Error: AddressList not given')
  const addressArray = body.addressList.map(val => val.toLowerCase())
  const request = `${ADDRESS_SERVER_URL}/odbAddresses/`
  const getRes = await axios.post(request, { identities: addressArray })
  const rootStoreAddresses = getRes.data.data.rootStoreAddresses

  const profilePromiseArray = Object.keys(rootStoreAddresses)
    .filter((key) => !!rootStoreAddresses[key])
    .map(async (key) => {
      const rootStoreAddress = rootStoreAddresses[key]
      const cacheProfile = await cache.read(rootStoreAddress)
      const profile = cacheProfile || await getProfile(rootStoreAddress)
      if (!cacheProfile) cache.write(rootStoreAddress, profile)
      return {address: key , profile}
    })

  const profiles = await Promise.all(profilePromiseArray)
  const parsed = profiles.reduce((acc, val) => {
    acc[val['address']] = val['profile']
    return acc
  }, {})

  res.json(parsed)
});

app.listen(8081, () => {
 console.log("Server running on port 8081");
});
