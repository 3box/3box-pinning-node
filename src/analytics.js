const SegmentAnalytics = require('analytics-node')

class Analytics {
  constructor (writeKey) {
    this.client = writeKey ? new SegmentAnalytics(writeKey) : {}
  }

  track (payload) {
    if (this.client) {
      payload.anonymousId = '3box'
      this.client.track({ payload })
    }
  }
}
module.exports = Analytics
