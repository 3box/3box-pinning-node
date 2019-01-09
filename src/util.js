
const fs = require('fs')
const getSize = require('get-folder-size')

/**
  *  Collection of utilities to measure important KPIs
  */
class Util {
  constructor (orbitDbDir) {
    this.orbitDbDir = orbitDbDir
  }

  getTotalRootStores () {
    let total = 0
    total = fs.readdirSync(this.orbitDbDir, (err, files) => {
      if (err) {
        throw new Error('Error getting the number of root stores', err)
      }
      return files
    })
    return total.length
  }

  getIPFSDiskUsage () {
    let totalSize = 0
    getSize(this.ipfsDir, (err, size) => {
      if (err) { throw err }
      totalSize = size
    })
    return (totalSize / 1024 / 1024).toFixed(2) + ' Mb'
  }
}
module.exports = Util
