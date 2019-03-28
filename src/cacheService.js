const express = require('express')
const axios = require('axios')
const Util = require('./util')
const { InvalidInputError, ProfileNotFound } = require('./errors')

const namesTothreadName = (spaceName, threadName) => `3box.thread.${spaceName}.${threadName}`

class CacheService {
  constructor (cache, pinning, addressServer) {
    this.cache = cache
    this.pinning = pinning
    this.addressServer = addressServer
    this.app = express()
    this.app.use(express.json())
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      next()
    })
    this.app.get('/profile', this.getProfile.bind(this))
    this.app.post('/profileList', this.getProfiles.bind(this))
    this.app.get('/space', this.getSpace.bind(this))
    this.app.get('/list-spaces', this.listSpaces.bind(this))
    this.app.get('/thread', this.getThread.bind(this))
  }

  start () {
    this.app.listen(8081, () => {
      console.log('Cache service running on port 8081')
    })
  }

  async listSpaces (req, res, next) {
    const { address, did } = req.query

    try {
      const rootStoreAddress = await this.queryToRootStoreAddress({ address, did })
      const cacheSpaces = await this.cache.read(`space-list_${rootStoreAddress}`)
      const spaces = cacheSpaces || await this.pinning.listSpaces(rootStoreAddress)

      res.json(spaces)
      if (!cacheSpaces) this.cache.write(`space-list_${rootStoreAddress}`, spaces)
    } catch (e) {
      return errorToResponse(res, e, 'Error: Failed to load spaces')
    }
  }

  async getSpace (req, res, next) {
    const { address, did, metadata } = req.query
    const spaceName = req.query.name

    try {
      const rootStoreAddress = await this.queryToRootStoreAddress({ address, did })
      const cacheSpace = await this.cache.read(`${rootStoreAddress}_${spaceName}`)
      const space = cacheSpace || await this.pinning.getSpace(rootStoreAddress, spaceName)

      res.json(this._mungeSpace(space, metadata))
      if (!cacheSpace) this.cache.write(`${rootStoreAddress}_${spaceName}`, space)
    } catch (e) {
      return errorToResponse(res, e, 'Error: Failed to load space')
    }
  }

  async getThread (req, res, next) {
    const spaceName = req.query.space
    const threadName = req.query.name

    const fullName = namesTothreadName(spaceName, threadName)
    const cachePosts = await this.cache.read(fullName)
    let posts
    try {
      posts = cachePosts || await this.pinning.getThread(fullName)
    } catch (e) {
      res.status(500).send('Error: Failed to load posts')
      return
    }
    res.json(posts)
    if (!cachePosts) this.cache.write(fullName, posts)
  }

  async ethereumToRootStoreAddress (address) {
    const normalized = address.toLowerCase()
    const url = `${this.addressServer}/odbAddress/${normalized}`

    try {
      const r = await axios.get(url)
      return r.data.data.rootStoreAddress
    } catch (e) {
      throw ProfileNotFound('Address link not found, address does not have a 3Box or is malformed')
    }
  }

  async ethereumToRootStoreAddresses (addresses) {
    if (!addresses || addresses.length === 0) {
      return {}
    }

    const normalized = addresses.map(x => x.toLowerCase())
    const url = `${this.addressServer}/odbAddresses/`

    try {
      const r = await axios.post(url, { identities: normalized })
      return r.data.data.rootStoreAddresses
    } catch (e) {
      throw ProfileNotFound('Addresses links not found, addressList is likely malformed')
    }
  }

  async didToRootStoreAddress (did) {
    return Util.didToRootStoreAddress(did, this.pinning)
  }

  async didToRootStoreAddresses (dids) {
    if (!dids || dids.length === 0) {
      return {}
    }

    // Load the dids
    const promises = dids.map((did) => this.didToRootStoreAddress(did))
    const xs = await Promise.all(promises)

    // Turn the results into a map did -> rootStoreAddress
    const r = {}
    dids.forEach((did, i) => {
      r[did] = xs[i]
    })
    return r
  }

  async queryToRootStoreAddress ({ address, did }) {
    // Check input
    if (!address && !did) {
      throw InvalidInputError('Either pass an `address` or `did` parameter')
    } else if (address && did) {
      throw InvalidInputError('Both `address` and `did` parameters where passed')
    }

    // Figure out the address
    if (address) {
      return this.ethereumToRootStoreAddress(decodeURIComponent(address))
    } else {
      return this.didToRootStoreAddress(decodeURIComponent(did))
    }
  }

  /**
   * Process back the profile into a form that depends whether the user queried
   * for metadata or not.
   *
   * Returns either the profile
   * - WITH metadata: `{name: {timestamp: 123123123123, value: "Dvorak"}, ...}`
   * - WITHOUT metadata: `{name: "Dvorak", ...}`
   */
  _mungeProfile (profile, metadata) {
    if (metadata) {
      // For now we return everything,
      // later we might filter the metadata (metadata="value,timestamp" for example)
      return profile
    } else {
      // process back the profile into a for without metadata
      const r = {}
      Object.entries(profile)
        .forEach(([k, v]) => {
          r[k] = v.value
        })
      return r
    }
  }

  _mungeSpace (space, metadata) {
    return this._mungeProfile(space, metadata)
  }

  async getProfile (req, res, next) {
    const { address, did, metadata } = req.query

    try {
      const rootStoreAddress = await this.queryToRootStoreAddress({ address, did })

      // Input to corresponding profile store address
      const cacheProfile = await this.cache.read(rootStoreAddress)
      const profile = cacheProfile || await this.pinning.getProfile(rootStoreAddress)

      res.json(this._mungeProfile(profile, metadata))

      if (!cacheProfile) this.cache.write(rootStoreAddress, profile)
    } catch (e) {
      return errorToResponse(res, e, 'Error: Failed to load profile')
    }
  }

  // TODO return {address: profile} or return array of [{address: profile}].
  // Request body of form { addressList: ['address1', 'address2', ...], didList: ['did1', 'did2', ...]}
  async getProfiles (req, res, next) {
    const { body } = req
    const { metadata, addressList, didList } = body

    if (!addressList && !didList) {
      return res.status(400).send('Error: AddressList not given')
    }

    // map addresses -> root stores
    const addrFromEth = await this.ethereumToRootStoreAddresses(addressList || [])
    const addrFromDID = await this.didToRootStoreAddresses(didList || [])
    const rootStoreAddresses = { ...addrFromEth, ...addrFromDID }

    // Load the data
    const profilePromiseArray = Object.keys(rootStoreAddresses)
      .filter((key) => !!rootStoreAddresses[key])
      .map(async (key) => {
        const rootStoreAddress = rootStoreAddresses[key]
        const cacheProfile = await this.cache.read(rootStoreAddress)
        const profile = cacheProfile || await this.pinning.getProfile(rootStoreAddress)

        if (!cacheProfile) this.cache.write(rootStoreAddress, profile)

        return { address: key, profile: this._mungeProfile(profile, metadata) }
      })

    const profiles = await Promise.all(profilePromiseArray)
    const parsed = profiles.reduce((acc, val) => {
      acc[val['address']] = val['profile']
      return acc
    }, {})

    res.json(parsed)
  }
}

/**
 * On error, return a response with the corresponding http status code, defaults to a 500.
 */
function errorToResponse (response, error, defaultMesssage) {
  if (error.statusCode) {
    return response.status(error.statusCode).send({ status: 'error', message: error.message })
  } else {
    return response.status(500).send(defaultMesssage)
  }
}

module.exports = CacheService
