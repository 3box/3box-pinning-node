const OrbitDB = require('orbit-db')
const Util = require('../util')
const { makeIPFS } = require('./tools')

const IPFS_PATH = './tmp/ipfs-did-1'
const ODB_PATH = './tmp/orbitdb-did-1'

const IPFS_CONF = {
  EXPERIMENTAL: {
    pubsub: true
  },
  repo: IPFS_PATH,
  config: {
    Addresses: {
      Swarm: [
        '/ip4/127.0.0.1/tcp/4016',
        '/ip4/127.0.0.1/tcp/4017/ws'
      ],
      API: '/ip4/127.0.0.1/tcp/5014',
      Gateway: '/ip4/127.0.0.1/tcp/9192'
    }
  }
}

const DID = 'did:muport:QmNQLKvMqGrDCrzmFS2C5p2JaRZ7bk6DqY7RJinhJoVxVT'
const IPFS_ADDR = 'QmNQLKvMqGrDCrzmFS2C5p2JaRZ7bk6DqY7RJinhJoVxVT'
const COMPRESSED_KEY = '02d1f48e3d5c52954a01f1aa104bad1a22e2eed6ecbd4961737fbffa8d75457cd4'
const UNCOMPRESSED_KEY = '04d1f48e3d5c52954a01f1aa104bad1a22e2eed6ecbd4961737fbffa8d75457cd4ab9b98ef29b96c6a1bbc54c2b9ded4ea6e803c50201c38c017b7b34c7a2451e8'
const MANIFEST = '{"version":1,"signingKey":"02d1f48e3d5c52954a01f1aa104bad1a22e2eed6ecbd4961737fbffa8d75457cd4","managementKey":"0x3334d0c1fd88529a1285a5f3c9cd71b382684073","asymEncryptionKey":"/MklZEmpCWWbUL/n5qnzLfEo6K0rtrtOrp60qNzrgVU="}'
const ROOT_STORE_ADDR = '/orbitdb/QmYoTE9PGvofB6EDFsJtxbGRjNCKRd8MJj9dyfguunTRfz/12209fc6c6005af752c4297a187a55dfd5bb55e1f07e4b5022915dc803f3a6ae699c.root'

describe('basic low level functions are working', () => {
  test('uncompress produces the correct key', () => {
    expect(Util.uncompressSECP256K1Key(COMPRESSED_KEY)).toEqual(UNCOMPRESSED_KEY)
  })

  test('extract ipfs address from a DID', () => {
    expect(Util.didExtractIPFSAddress(DID)).toEqual(IPFS_ADDR)
    expect(() => Util.didExtractIPFSAddress(null)).toThrow()
    expect(() => Util.didExtractIPFSAddress('some-string')).toThrow()
    expect(() => Util.didExtractIPFSAddress('some:string:Qm12')).toThrow()
    expect(() => Util.didExtractIPFSAddress('did:some-scheme:Qm12')).toThrow()
    expect(() => Util.didExtractIPFSAddress('did:muport:Qmé')).toThrow()
  })

  test('did extract signing key', async () => {
    const ipfs = { files: { cat: jest.fn(() => Promise.resolve(MANIFEST)) } }
    const k = await Util.didExtractSigningKey(IPFS_ADDR, ipfs)
    expect(k).toEqual('02d1f48e3d5c52954a01f1aa104bad1a22e2eed6ecbd4961737fbffa8d75457cd4')
  })
})

describe('test with network', () => {
  jest.setTimeout(30000)
  let ipfs = undefined
  let orbitdb = undefined

  beforeAll(async () => {
    ipfs = await makeIPFS(IPFS_CONF)
    orbitdb = new OrbitDB(ipfs, ODB_PATH)
  })

  afterAll(async () => {
    return ipfs.close()
  })

  it('can retrieve a root store', async () => {
    const addr = await Util.didToRootStoreAddress(DID, { ipfs, orbitdb })
    expect(addr).toEqual(ROOT_STORE_ADDR)
  })
})