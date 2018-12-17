#!/usr/bin/env node

require('dotenv').config()
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
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
const ipfsOptions = {
  EXPERIMENTAL: {
    pubsub: true
  }
}

let openDBs = {}

async function startIpfsDaemon () {
  // Create IPFS instance
  const ipfs = new IPFS(ipfsOptions)
  return new Promise((resolve, reject) => {
    ipfs.on('error', (e) => console.error(e))
    ipfs.on('ready', () => resolve(ipfs))
  })
}

let orbitdb, ipfs, pubsub

async function initServices() {
  ipfs = await startIpfsDaemon()
  const ipfsId = await ipfs.id()
  console.log(ipfsId)
  orbitdb = new OrbitDB(ipfs, ORBITDB_PATH)
  pubsub = new Pubsub(ipfs, ipfsId.id)
  return
}

async function pinningNode () {
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

/*********************
 *    Profile API    *
 *********************/

const getProfile = async (rootStoreAddress) => {
  let rootStore
  if (!openDBs[rootStoreAddress]) {
    rootStore = await orbitdb.open(rootStoreAddress)
    const readyPromise = new Promise((resolve, reject) => {
      rootStore.events.on('ready', resolve)
    })
    rootStore.load()
    await readyPromise
  } else {
    rootStore = openDBs[rootStoreAddress]
  }

  const profileEntry = rootStore
    .iterator({ limit: -1 })
    .collect()
    .find(entry => {
      return entry.payload.value.odbAddress.split('.')[1] === 'public'
    })

  const pubStoreAddress = profileEntry.payload.value.odbAddress

  let publicStore
  if (!openDBs[pubStoreAddress]) {
    publicStore = await orbitdb.open(pubStoreAddress)
    const readyPromisePublic = new Promise((resolve, reject) => {
      publicStore.events.on('ready', resolve)
    })
    publicStore.load()
    await readyPromisePublic
  } else {
    publicStore = openDBs[pubStoreAddress]
  }

  const profile = publicStore.all()

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
  let profile
  try {
    profile = cacheProfile || await getProfile(rootStoreAddress)
  } catch(e) {
    res.status(500).send('Error: Failed to load profile')
    return
  }
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

/**************************************
 *    Start Pinning Service and API   *
 **************************************/

async function start() {
  await initServices()
  pinningNode()
  app.listen(8081, () => {
   console.log("Server running on port 8081");
  })
}

start()
