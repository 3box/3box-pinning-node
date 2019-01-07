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

  afterAll(async () => {
    await fs.rmdir(path)
  })
})
