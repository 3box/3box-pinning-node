const elliptic = require('elliptic')
const Multihash = require('multihashes')
const sha256 = require('js-sha256').sha256
const { InvalidDIDFormat } = require('./errors')

const RE_DID_MUPORT = /^did:muport:(\w+)$/

/**
 *  Collection of utilities to measure important KPIs
 */
class Util {
  constructor () { }

  /**
   * Compute a multi-hash that is used in the did to root store process (fingerprinting)
   */
  static sha256Multihash (str) {
    const digest = Buffer.from(sha256.digest(str))
    return Multihash.encode(digest, 'sha2-256').toString('hex')
  }

  static uncompressSECP256K1Key (key) {
    const ec = new elliptic.ec('secp256k1') // eslint-disable-line new-cap
    return ec.keyFromPublic(key, 'hex').getPublic(false, 'hex')
  }

  static didExtractIPFSAddress (did) {
    if (!did) {
      throw InvalidDIDFormat('null')
    }

    const match = did.match(RE_DID_MUPORT)

    if (!match) {
      throw InvalidDIDFormat(did)
    }

    return match[1]
  }

  static async didExtractSigningKey (manifestIPFSAddr, ipfs) {
    const content = await ipfs.files.cat(manifestIPFSAddr)
    const data = JSON.parse(content.toString())
    return data.signingKey
  }

  static async didToRootStoreAddress (did, { ipfs, orbitdb }) {
    const ipfsManifest = Util.didExtractIPFSAddress(did)
    const signingKeyCompressed = await Util.didExtractSigningKey(ipfsManifest, ipfs)

    const signingKey = Util.uncompressSECP256K1Key(signingKeyCompressed)
    const fingerprint = Util.sha256Multihash(did)

    const rootStore = `${fingerprint}.root`

    const addr = await orbitdb.determineAddress(rootStore, 'feed', { write: [signingKey] })

    return addr.toString()
  }
}

module.exports = Util
