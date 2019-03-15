const express = require('express')
const axios = require('axios')

class CacheService {
  constructor (cache, pinning, addressServer) {
    this.cache = cache
    this.pinning = pinning
    this.addressServer = addressServer
    this.app = express()
    this.app.use(express.json())
    this.app.get('/profile', this.getProfile.bind(this))
    this.app.post('/profileList', this.getProfiles.bind(this))
    this.app.get('/space', this.getSpace.bind(this))
    this.app.get('/list-spaces', this.listSpaces.bind(this))
  }

  start () {
    this.app.listen(8081, () => {
      console.log('Cache service running on port 8081')
    })
  }

  async listSpaces (req, res, next) {
    const address = req.query.address.toLowerCase()
    const request = `${this.addressServer}/odbAddress/${address}`
    let getRes
    try {
      getRes = await axios.get(request)
    } catch (e) {
      res.status(404).send({ status: 'error', message: 'Address link not found, address does not have a 3Box or is malformed' })
      return
    }
    const rootStoreAddress = getRes.data.data.rootStoreAddress
    const cacheSpaces = await this.cache.read(`space-list_${rootStoreAddress}`)
    let spaces
    try {
      spaces = cacheSpaces || await this.pinning.listSpaces(rootStoreAddress)
    } catch (e) {
      res.status(500).send('Error: Failed to load spaces')
      return
    }
    res.json(spaces)
    if (!cacheSpaces) this.cache.write(`space-list_${rootStoreAddress}`, spaces)
  }

  async getSpace (req, res, next) {
    const address = req.query.address.toLowerCase()
    const spaceName = req.query.name
    const request = `${this.addressServer}/odbAddress/${address}`
    let getRes
    try {
      getRes = await axios.get(request)
    } catch (e) {
      res.status(404).send({ status: 'error', message: 'Address link not found, address does not have a 3Box or is malformed' })
      return
    }
    const rootStoreAddress = getRes.data.data.rootStoreAddress
    const cacheSpace = await this.cache.read(`${rootStoreAddress}_${spaceName}`)
    let space
    try {
      space = cacheSpace || await this.pinning.getSpace(rootStoreAddress, spaceName)
    } catch (e) {
      res.status(500).send('Error: Failed to load space')
      return
    }
    res.json(space)
    if (!cacheSpace) this.cache.write(`${rootStoreAddress}_${spaceName}`, space)
  }

  async getProfile (req, res, next) {
    const address = req.query.address.toLowerCase()
    const request = `${this.addressServer}/odbAddress/${address}`
    let getRes
    try {
      getRes = await axios.get(request)
    } catch (e) {
      res.status(404).send({ status: 'error', message: 'Address link not found, address does not have a 3Box or is malformed' })
      return
    }
    const rootStoreAddress = getRes.data.data.rootStoreAddress
    const cacheProfile = await this.cache.read(rootStoreAddress)
    let profile
    try {
      profile = cacheProfile || await this.pinning.getProfile(rootStoreAddress)
    } catch (e) {
      res.status(500).send('Error: Failed to load profile')
      return
    }
    res.json(profile)
    if (!cacheProfile) this.cache.write(rootStoreAddress, profile)
  }

  // TODO return {address: profile} or return array of [{address: profile}].
  // Request body of form { addressList: ['address1', 'address2', ...]}
  async getProfiles (req, res, next) {
    const body = req.body
    if (!body.addressList) res.status(500).send('Error: AddressList not given')
    const addressArray = body.addressList.map(val => val.toLowerCase())
    const request = `${this.addressServer}/odbAddresses/`
    let getRes
    try {
      getRes = await axios.post(request, { identities: addressArray })
    } catch (e) {
      res.status(404).send({ status: 'error', message: 'Addresses links not found, addressList is likely malformed' })
      return
    }
    const rootStoreAddresses = getRes.data.data.rootStoreAddresses

    const profilePromiseArray = Object.keys(rootStoreAddresses)
      .filter((key) => !!rootStoreAddresses[key])
      .map(async (key) => {
        const rootStoreAddress = rootStoreAddresses[key]
        const cacheProfile = await this.cache.read(rootStoreAddress)
        const profile = cacheProfile || await this.pinning.getProfile(rootStoreAddress)
        if (!cacheProfile) this.cache.write(rootStoreAddress, profile)
        return { address: key, profile }
      })

    const profiles = await Promise.all(profilePromiseArray)
    const parsed = profiles.reduce((acc, val) => {
      acc[val['address']] = val['profile']
      return acc
    }, {})

    res.json(parsed)
  }
}

module.exports = CacheService
