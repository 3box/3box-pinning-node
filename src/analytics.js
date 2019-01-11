const SegmentAnalytics = require('analytics-node')

class Analytics {
  constructor (writeKey) {
    this.client = writeKey ? new SegmentAnalytics(writeKey) : {}
  }

  _track (data = {}) {
    if (this.client) {
      data.anonymousId = '3box'
      data.properties.time = Date.now()
      return this.client.track(data)
    } else {
      return false
    }
  }

  trackOpenDB (address, duration) {
    let data = {}
    data.event = 'open_db'
    data.properties = { address: address, duration: duration }
    this._track(data)
  }

  trackGetProfile (address, profileExisted) {
    let data = {}
    data.event = 'get_profile'
    data.properties = { address: address, profile_existed: profileExisted }
    this._track(data)
  }

  trackPinDB (odbAddress) {
    let data = {}
    data.event = 'pin_db'
    data.properties = { odb_address: odbAddress }
    this._track(data)
  }

  trackInfraMetrics (orbitStores, orbitDiskUsage, ipfsDiskUsage) {
    let data = {}
    data.event = 'infra_metrics'
    data.properties = {
      total_orbit_stores: orbitStores,
      orbit_disk_usage: orbitDiskUsage,
      ipfs_disk_usage: ipfsDiskUsage
    }
    this._track(data)
  }
}
module.exports = Analytics
