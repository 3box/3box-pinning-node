jest.mock('express', () => {
  const express = function () {
    return {
        use: jest.fn(), get: jest.fn(),
        post: jest.fn(), listen: jest.fn(),
      }
    }
  express.json = jest.fn()
  return express
})
jest.mock('axios', () => {
  return {
    get: jest.fn(() => { return { data: { data: { rootStoreAddress: 'rsa' } } } }),
    post: jest.fn()
  }
})
const CacheService = require('../cacheService')
const cache = {
  read: jest.fn(() => { return { name: 'testName' } }),
  write: jest.fn()
}
const pinning = {
  getProfile: jest.fn(() => { return { name: 'testName' } })
}

const ADDRESS_SERVER_URL = 'address-server'

describe('CacheService', () => {
  let cs

  beforeEach(async () => {
    cache.read.mockClear()
    cache.write.mockClear()
  })

  it('constructor works as expected', async () => {
    cs = new CacheService(cache, pinning, ADDRESS_SERVER_URL)
    expect(cs.app.use).toHaveBeenCalledTimes(1)
    expect(cs.app.get).toHaveBeenCalledTimes(1)
    expect(cs.app.post).toHaveBeenCalledTimes(1)
  })

  it('should start service correctly', async () => {
    cs.start()
    expect(cs.app.listen).toHaveBeenCalledTimes(1)
  })

  it('should get profile correctly, with cache', async () => {
    const req = { query: { address: '0x12345' } }
    const res = { json: jest.fn() }
    await cs.getProfile(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('rsa')
    expect(cs.pinning.getProfile).toHaveBeenCalledTimes(0)
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith({ name: 'testName' })
    expect(cs.cache.write).toHaveBeenCalledTimes(0)
  })

  it('should get profile correctly, without cache', async () => {
    const req = { query: { address: '0x12345' } }
    const res = { json: jest.fn() }
    cache.read.mockImplementationOnce(() => null)
    await cs.getProfile(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('rsa')
    expect(cs.pinning.getProfile).toHaveBeenCalledTimes(1)
    expect(cs.pinning.getProfile).toHaveBeenCalledWith('rsa')
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith({ name: 'testName' })
    expect(cs.cache.write).toHaveBeenCalledTimes(1)
    expect(cs.cache.write).toHaveBeenCalledWith('rsa', { name: 'testName' })
  })

  it.skip('should get profiles correctly, with cache', async () => {
  })

  it.skip('should get profiles correctly, without cache', async () => {
  })

  it.skip('should get profiles correctly, with mixed cache', async () => {
  })
})
