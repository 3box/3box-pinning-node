const IPFS = require('ipfs')

test('this is a test tools module', () => {})

async function makeIPFS (conf) {
  return new Promise((resolve, reject) => {
    let ipfs = new IPFS(conf)
    ipfs.on('error', reject)
    ipfs.on('ready', () => resolve(ipfs))
  })
}

module.exports = {
  makeIPFS
}
