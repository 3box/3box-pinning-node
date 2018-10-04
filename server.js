#!/usr/bin/env node

const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const Room = require('ipfs-pubsub-room')

const ipfsOptions = {
  EXPERIMENTAL: {
    pubsub: true
  }
}

// Create IPFS instance
const ipfs = new IPFS(ipfsOptions)
let storeDBs = []

ipfs.on('error', (e) => console.error(e))
ipfs.on('ready', async () => {
  console.log(await ipfs.id())
  const room = Room(ipfs, '3box')
  const orbitdb = new OrbitDB(ipfs, '/opt/orbitdb')

  room.on('peer joined', (peer) => {
    console.log('Peer joined the room', peer)
  })

  room.on('peer left', (peer) => {
    console.log('Peer left...', peer)
  })

  room.on('subscribed', () => {
    console.log('Connected to the room')
  })

  room.on('message', async (message) => {
    let msgData = message.data.toString()
    console.log('incoming message', msgData)

    const rootDB = await orbitdb.open(msgData)
    const readyPromise = new Promise((resolve, reject) => {
      rootDB.events.on('ready', () => {
        rootDB.iterator({ limit: -1 }).collect().map(entry => {
          const odbAddress = entry.payload.value.odbAddress
          openDB(odbAddress)
        })
        resolve()
      })
    })
    rootDB.load()

    rootDB.events.on(
      'replicate.progress',
      (odbAddress, entryHash, entry, num, max) => {
        openDB(entry.payload.value.odbAddress)
        console.log('Replicating entry:', entryHash)
        console.log('On db:', odbAddress)
        if (num === max) {
          rootDB.events.on('replicated', () => {
            console.log('Fully replicated db:', odbAddress)
          })
        }
      }
    )
    await readyPromise

    async function openDB (address, onProgress = () => { }) {
      console.log('Opening db:', address)
      let db = await orbitdb.open(address)
      db.load()
      storeDBs.push(db)
      db.events.on(
        'replicate.progress',
        (odbAddress, entryHash, entry, num, max) => {
          onProgress(entry)
          console.log('Replicating entry:', entryHash)
          console.log('On db:', odbAddress)
          if (num === max) {
            db.events.on('replicated', () => {
              console.log('Fully replicated db:', odbAddress)
            })
          }
        }
      )
    }
  })
})
