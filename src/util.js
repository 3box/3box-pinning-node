
const fs = require('fs')
const getSize = require('get-folder-size')

/**
  *  Collection of utilities to measure important KPIs
  */
class Util {
  constructor (orbitDbDir, ipfsDir) {
    this.orbitDbDir = orbitDbDir
    this.ipfsDir = ipfsDir
  }

  getTotalOrbitStores () {
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
    return this._getDiskUsage(this.ipfsDir)
  }

  getOrbitDBDiskUsage () {
    return this._getDiskUsage(this.orbitDbDir)
  }

  _getDiskUsage (dir) {
    let totalSize = 0
    getSize(dir, (err, size) => {
      if (err) { throw err }
      totalSize = size
    })
    return (totalSize / 1024 / 1024).toFixed(2) + ' Mb'
  }
}
module.exports = Util
