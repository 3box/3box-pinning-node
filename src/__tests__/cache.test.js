jest.mock('redis', () => {
  return {
    createClient: jest.fn(() => {
      return {
        on: jest.fn(),
        get: jest.fn((key, fn) => fn(null, key.includes('space') ? '["s1", "s2"]' : '"someVal"')),
        set: jest.fn(),
        del: jest.fn()
      }
    })
  }
})

const { RedisCache } = require('../cache')
const TTL = 12345

describe('RedisCache', () => {
  let cache

  beforeAll(async () => {
    cache = new RedisCache({ host: 'somepath' }, TTL)
  })

  it('should read values correctly', async () => {
    const val = await cache.read('test')

    expect(val).toEqual('someVal')
    expect(cache.redis.get).toHaveBeenCalledTimes(1)
  })

  it('should write values correctly', async () => {
    await cache.write('test', { test: 123 })

    expect(cache.redis.set).toHaveBeenCalledTimes(1)
    expect(cache.redis.set).toHaveBeenCalledWith('test', JSON.stringify({ test: 123 }), 'EX', TTL)
  })

  it('should write values correctly', async () => {
    await cache.invalidate('test')

    expect(cache.redis.del).toHaveBeenCalledTimes(4)
    expect(cache.redis.del).toHaveBeenNthCalledWith(1, 'space-list_test')
    expect(cache.redis.del).toHaveBeenNthCalledWith(2, 'test')
    expect(cache.redis.del).toHaveBeenNthCalledWith(3, 'test_s1')
    expect(cache.redis.del).toHaveBeenNthCalledWith(4, 'test_s2')
  })
})
