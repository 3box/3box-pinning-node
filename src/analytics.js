const SegmentAnalytics = require('analytics-node')

class Analytics {
  constructor (writeKey, active = true) {
    this.client = writeKey && active ? new SegmentAnalytics(writeKey) : null
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

  trackListSpaces (address) {
    let data = {}
    data.event = 'list_spaces'
    data.properties = { address: address }
    this._track(data)
  }

  trackGetThread (address) {
    let data = {}
    data.event = 'get_thread'
    data.properties = { address: address }
    this._track(data)
  }

  trackGetSpace (address, name, spaceExisted) {
    let data = {}
    data.event = 'get_space'
    data.properties = { address: address, name: name, profile_existed: spaceExisted }
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

  trackInfraMetrics () {
    let data = {}
    data.event = 'infra_metrics'
    data.properties = {
      resident_memory_usage: process.memoryUsage().rss / 1024 / 1024,
      heap_total_memory: process.memoryUsage().heapTotal / 1024 / 1024,
      heap_used_memory: process.memoryUsage().heapUsed / 1024 / 1024
    }
    this._track(data)
  }
}
module.exports = Analytics
