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

  trackOpenDB (opts = {}) {
    let data = {}
    data.event = 'open_box'
    data.properties = opts
    this._track(data)
  }

  trackGetProfile (opts = {}) {
    let data = {}
    data.event = 'get_profile'
    data.properties = opts
    this._track(data)
  }
}
module.exports = Analytics
