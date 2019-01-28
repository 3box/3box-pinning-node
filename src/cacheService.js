const express = require('express')
const axios = require('axios')

class CacheService {
  constructor (cache, pinning, addressServer) {
    this.cache = cache
    this.pinning = pinning
    this.addressServer = addressServer
    this.app = express()
    this.app.use(express.json())
    this.app.use(function(req, res, next) {
      res.header("Access-Control-Allow-Origin", "*");
      next();
    });
    this.app.get('/profile', this.getProfile.bind(this))
    this.app.post('/profileList', this.getProfiles.bind(this))
  }

  start () {
    this.app.listen(8081, () => {
      console.log('Cache service running on port 8081')
    })
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
