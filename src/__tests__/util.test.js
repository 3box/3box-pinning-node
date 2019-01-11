const Util = require('../util')
const fs = require('fs')

describe('Util', () => {
  let u
  let path = './tmp/test'

  beforeEach(() => {
    u = new Util(path, path)
  })

  it('counts the number of orbit stores', () => {
    let count = u.getTotalOrbitStores()
    expect(count).toEqual(1)
  })

  it('measure ipfs disk usage', () => {
    let size = u.getIPFSDiskUsage()
    expect(size).toEqual('0.00 Mb')
  })

  afterAll(async () => {
    await fs.rmdir(path)
  })
})
