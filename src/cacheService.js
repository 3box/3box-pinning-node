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
  }

  start () {
    this.app.listen(8081, () => {
      console.log('Cache service running on port 8081')
    })
  }

  async getProfile (req, res, next) {
    const address = req.query.address.toLowerCase()
    const request = `${this.addressServer}/odbAddress/${address}`
    const getRes = await axios.get(request)
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
    const getRes = await axios.post(request, { identities: addressArray })
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
