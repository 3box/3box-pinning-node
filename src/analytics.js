const SegmentAnalytics = require('analytics-node')

class Analytics {
  constructor (client) {
    this.client = client
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
}

class AnalyticsNode extends Analytics {
  // trackOpenDB (address, duration) {
  //   let data = {}
  //   data.event = 'open_db'
  //   data.properties = { address: address, duration: duration }
  //   this._track(data)
  // }

  trackPinDB (odbAddress) {
    let data = {}
    data.event = 'pin_db'
    data.properties = { odb_address: odbAddress }
    this._track(data)
  }

  trackSyncDB (odbAddress) {
    let data = {}
    data.event = 'sync_db'
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

  trackSpaceUpdate (address, spaceName, rootAddress) {
    let data = {}
    data.event = 'space_update'
    data.properties = { address, space: spaceName, root_address: rootAddress }
    this._track(data)
  }

  trackPublicUpdate (address, rootAddress) {
    let data = {}
    data.event = 'public_update'
    data.properties = { address, root_address: rootAddress }
    this._track(data)
  }

  // TODO differentiate types of updates
  trackRootUpdate (address) {
    let data = {}
    data.event = 'root_update'
    data.properties = { address }
    this._track(data)
  }

  trackThreadUpdate (address) {
    let data = {}
    data.event = 'thread_update'
    data.properties = { address }
    this._track(data)
  }
}

class AnalyticsAPI extends Analytics {
  trackListSpaces (address, status) {
    let data = {}
    data.event = 'api_list_spaces'
    data.properties = { address: address, status }
    this._track(data)
  }

  trackGetConfig (address, status) {
    let data = {}
    data.event = 'api_get_config'
    data.properties = { address: address, status }
    this._track(data)
  }

  trackGetThread (address, status) {
    let data = {}
    data.event = 'api_get_thread'
    data.properties = { address: address, status }
    this._track(data)
  }

  trackGetSpace (address, name, spaceExisted, status) {
    let data = {}
    data.event = 'api_get_space'
    data.properties = { address: address, name: name, profile_existed: spaceExisted, status }
    this._track(data)
  }

  trackGetProfile (address, profileExisted, status) {
    let data = {}
    data.event = 'api_get_profile'
    data.properties = { address: address, profile_existed: profileExisted, status }
    this._track(data)
  }

  trackGetProfiles (status) {
    let data = {}
    data.event = 'api_get_profiles'
    data.properties = { status }
    this._track(data)
  }
}

module.exports = (writeKey, active = true) => {
  const client = writeKey && active ? new SegmentAnalytics(writeKey) : null
  return {
    api: new AnalyticsAPI(client),
    node: new AnalyticsNode(client)
  }
}
