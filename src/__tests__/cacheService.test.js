jest.mock('express', () => {
  const express = function () {
    return {
      use: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      listen: jest.fn(() => { return { keepAliveTimeout:0}})
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

const ADDRESS_SERVER_URL = 'address-server'

const PROFILE_1 = { name: { value: 'testName', timestamp: 12 } }
const SPACE_1 = { data: { value: 'testData', timestamp: 13 } }
const SPACES_1 = ['space0', 'space1']
const THREADS_1 = ['posts1', 'posts2']

const cache = {
  read: jest.fn(key => {
    if (key === 'rsa') {
      return PROFILE_1
    } else if (key === 'rsa_space1') {
      return SPACE_1
    } else if (key.startsWith('3box.thread')) {
      return THREADS_1
    } else {
      return SPACES_1
    }
  }),
  write: jest.fn()
}

const pinning = {
  getProfile: jest.fn(() => PROFILE_1),
  getSpace: jest.fn(() => SPACE_1),
  listSpaces: jest.fn(() => SPACES_1),
  getThread: jest.fn(() => THREADS_1)
}

describe('CacheService', () => {
  let cs

  beforeEach(async () => {
    cache.read.mockClear()
    cache.write.mockClear()
  })

  it('constructor works as expected', async () => {
    cs = new CacheService(cache, pinning, ADDRESS_SERVER_URL)
    expect(cs.app.use).toHaveBeenCalledTimes(2)
    expect(cs.app.get).toHaveBeenCalledTimes(4)
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
    expect(cs.cache.write).toHaveBeenCalledWith('rsa', PROFILE_1)
  })

  describe('Spaces', () => {
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
      expect(cs.cache.write).toHaveBeenCalledWith('rsa_space1', SPACE_1)
    })

    it('should list spaces correctly, with cache', async () => {
      const req = { query: { address: '0x12345' } }
      const res = { json: jest.fn() }
      await cs.listSpaces(req, res)

      expect(cs.cache.read).toHaveBeenCalledTimes(1)
      expect(cs.cache.read).toHaveBeenCalledWith('space-list_rsa')
      expect(cs.pinning.listSpaces).toHaveBeenCalledTimes(0)
      expect(res.json).toHaveBeenCalledTimes(1)
      expect(res.json).toHaveBeenCalledWith(SPACES_1)
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
      expect(res.json).toHaveBeenCalledWith(SPACES_1)
      expect(cs.cache.write).toHaveBeenCalledTimes(1)
      expect(cs.cache.write).toHaveBeenCalledWith('space-list_rsa', SPACES_1)
    })
  })

  describe('Threads', () => {
    it('should get thread correctly, with cache', async () => {
      const req = { query: { space: 'space1', name: 'thread1' } }
      const res = { json: jest.fn() }
      await cs.getThread(req, res)

      expect(cs.cache.read).toHaveBeenCalledTimes(1)
      expect(cs.cache.read).toHaveBeenCalledWith('3box.thread.space1.thread1')
      expect(cs.pinning.getThread).toHaveBeenCalledTimes(0)
      expect(res.json).toHaveBeenCalledTimes(1)
      expect(res.json).toHaveBeenCalledWith(THREADS_1)
      expect(cs.cache.write).toHaveBeenCalledTimes(0)
    })

    it('should get thread correctly, without cache', async () => {
      const req = { query: { space: 'space1', name: 'thread1' } }
      const res = { json: jest.fn() }
      cache.read.mockImplementationOnce(() => null)
      await cs.getThread(req, res)

      expect(cs.cache.read).toHaveBeenCalledTimes(1)
      expect(cs.cache.read).toHaveBeenCalledWith('3box.thread.space1.thread1')
      expect(cs.pinning.getThread).toHaveBeenCalledTimes(1)
      expect(cs.pinning.getThread).toHaveBeenCalledWith('3box.thread.space1.thread1')
      expect(res.json).toHaveBeenCalledTimes(1)
      expect(res.json).toHaveBeenCalledWith(THREADS_1)
      expect(cs.cache.write).toHaveBeenCalledTimes(1)
      expect(cs.cache.write).toHaveBeenCalledWith('3box.thread.space1.thread1', THREADS_1)
    })
  })

  it.skip('should get profiles correctly, with cache', async () => {
  })

  it.skip('should get profiles correctly, without cache', async () => {
  })

  it.skip('should get profiles correctly, with mixed cache', async () => {
  })
})
