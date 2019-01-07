const Util = require('../Util')
const fs = require('fs')

describe('Util', () => {
  let u
  let path = './test'

  beforeEach(() => {
    u = new Util(path)
  })

  it('counts the number of directories', () => {
    let count = u.getTotalRootStores()
    expect(count).toEqual(1)
  })

  it('counts the number of directories', () => {
    let size = u.getIPFSDiskUsage()
    expect(size).toEqual('0.00 Mb')
  })

  afterAll(async () => {
    await fs.rmdir(path)
  })
})
