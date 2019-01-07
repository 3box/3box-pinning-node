
const fs = require('fs')

/**
  *  Collection of utilities to measure important KPIs
  */
class Util {
  constructor (ipfsDir) {
    this.ipfsDir = ipfsDir
  }

  getTotalRootStores () {
    let total = 0
    total = fs.readdirSync(this.ipfsDir, (err, files) => {
      if (err) {
        throw new Error('Error getting the number of root stores', err)
      }
      return files
    })
    return total.length
  }
}
module.exports = Util
