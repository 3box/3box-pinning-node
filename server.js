#!/usr/bin/env node

require('dotenv').config()
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Pubsub = require('orbit-db-pubsub')
const DaemonFactory = require('ipfsd-ctl')
const fs = require('fs')

const ORBITDB_PATH = '/opt/orbitdb'
const IPFS_PATH = '/opt/ipfs'
const PINNING_ROOM = '3box-pinning'

let openDBs = {}

pinningNode()

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

async function pinningNode () {
  const ipfs = await startIpfsDaemon()
  console.log(await ipfs.id())
  const orbitdb = new OrbitDB(ipfs, ORBITDB_PATH)
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
