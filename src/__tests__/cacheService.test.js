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
  read: jest.fn(key => {
    if (key === 'rsa') {
      return { name: 'testName' }
    } else if (key === 'rsa_space1'){
      return { data: 'testData' }
    } else {
      return ['space0', 'space1']
    }
  }),
  write: jest.fn()
}
const pinning = {
  getProfile: jest.fn(() => { return { name: 'testName' } }),
  getSpace: jest.fn(() => { return { data: 'testData' } }),
  listSpaces: jest.fn(() => { return ['space1', 'space2'] })
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
    expect(cs.app.get).toHaveBeenCalledTimes(3)
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

  it('should get space correctly, with cache', async () => {
    const req = { query: { address: '0x12345', name: 'space1' } }
    const res = { json: jest.fn() }
    await cs.getSpace(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('rsa_space1')
    expect(cs.pinning.getSpace).toHaveBeenCalledTimes(0)
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith({ data: 'testData' })
    expect(cs.cache.write).toHaveBeenCalledTimes(0)
  })

  it('should get space correctly, without cache', async () => {
    const req = { query: { address: '0x12345', name: 'space1' } }
    const res = { json: jest.fn() }
    cache.read.mockImplementationOnce(() => null)
    await cs.getSpace(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('rsa_space1')
    expect(cs.pinning.getSpace).toHaveBeenCalledTimes(1)
    expect(cs.pinning.getSpace).toHaveBeenCalledWith('rsa', 'space1')
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith({ data: 'testData' })
    expect(cs.cache.write).toHaveBeenCalledTimes(1)
    expect(cs.cache.write).toHaveBeenCalledWith('rsa_space1', { data: 'testData' })
  })

  it('should list spaces correctly, with cache', async () => {
    const req = { query: { address: '0x12345' } }
    const res = { json: jest.fn() }
    await cs.listSpaces(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('space-list_rsa')
    expect(cs.pinning.listSpaces).toHaveBeenCalledTimes(0)
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith(['space0', 'space1'])
    expect(cs.cache.write).toHaveBeenCalledTimes(0)
  })

  it('should list spaces correctly, without cache', async () => {
    const req = { query: { address: '0x12345' } }
    const res = { json: jest.fn() }
    cache.read.mockImplementationOnce(() => null)
    await cs.listSpaces(req, res)

    expect(cs.cache.read).toHaveBeenCalledTimes(1)
    expect(cs.cache.read).toHaveBeenCalledWith('space-list_rsa')
    expect(cs.pinning.listSpaces).toHaveBeenCalledTimes(1)
    expect(cs.pinning.listSpaces).toHaveBeenCalledWith('rsa')
    expect(res.json).toHaveBeenCalledTimes(1)
    expect(res.json).toHaveBeenCalledWith(['space1', 'space2'])
    expect(cs.cache.write).toHaveBeenCalledTimes(1)
    expect(cs.cache.write).toHaveBeenCalledWith('space-list_rsa', ['space1', 'space2'])
  })

  it.skip('should get profiles correctly, with cache', async () => {
  })

  it.skip('should get profiles correctly, without cache', async () => {
  })

  it.skip('should get profiles correctly, with mixed cache', async () => {
  })
})
