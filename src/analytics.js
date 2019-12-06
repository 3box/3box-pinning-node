const SegmentAnalytics = require('analytics-node')
const sha256 = require('js-sha256').sha256

const hash = str => str === null ? null : Buffer.from(sha256.digest(str)).toString('hex')

class Analytics {
  constructor (client) {
    this.client = client
  }

  _track (data = {}, id) {
    if (this.client) {
      data.anonymousId = id || '3box'
      data.properties.time = Date.now()
      return this.client.track(data)
    } else {
      return false
    }
  }

  // trackOpenDB (address, duration) {
  //   let data = {}
  //   data.event = 'open_db'
  //   data.properties = { address: address, duration: duration }
  //   this._track(data)
  // }

  trackPinDB (did, newAccount) {
    const data = {}
    data.event = 'pin_db'
    data.properties = { new_account: newAccount }
    this._track(data, hash(did))
  }

  // backwards compatible, pindb for dbs with address links not in rootstore
  trackPinDBAddress (address) {
    const data = {}
    data.event = 'pin_db_address'
    data.properties = { address_hash: hash(address) }
    this._track(data, hash(address))
  }

  trackSyncDB (odbAddress) {
    const data = {}
    data.event = 'sync_db'
    data.properties = { address: odbAddress }
    this._track(data)
  }

  trackInfraMetrics () {
    const data = {}
    data.event = 'infra_metrics'
    data.properties = {
      resident_memory_usage: process.memoryUsage().rss / 1024 / 1024,
      heap_total_memory: process.memoryUsage().heapTotal / 1024 / 1024,
      heap_used_memory: process.memoryUsage().heapUsed / 1024 / 1024
    }
    this._track(data)
  }

  trackSpaceUpdate (address, spaceName, did) {
    const data = {}
    data.event = 'space_update'
    data.properties = { address, space: spaceName }
    this._track(data, hash(did))
    this.trackSpaceUpdateByApp(address, spaceName) // Temporary, to get uniques on spaceNames
  }

  trackSpaceUpdateByApp (address, spaceName) {
    const data = {}
    data.event = 'space_update_app'
    data.properties = { address, space: spaceName }
    this._track(data, spaceName)
  }

  trackPublicUpdate (address, did) {
    const data = {}
    data.event = 'public_update'
    data.properties = { address }
    this._track(data, hash(did))
  }

  trackPrivateUpdate (address, did) {
    const data = {}
    data.event = 'private_update'
    data.properties = { address }
    this._track(data, hash(did))
  }

  // TODO differentiate types of updates
  trackRootUpdate (did) {
    const data = {}
    data.event = 'root_update'
    data.properties = { }
    this._track(data, hash(did))
  }

  trackThreadUpdate (address, space, name) {
    const data = {}
    data.event = 'thread_update'
    data.properties = { address, space, name }
    this._track(data)
  }
}

module.exports = (writeKey, active = true) => {
  const client = writeKey && active ? new SegmentAnalytics(writeKey) : null
  return new Analytics(client)
}
