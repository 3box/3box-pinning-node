const redis = require('redis')

const encode = (value) => (typeof value === 'string' ? value : value.toString())
const decode = (value) => value ? parseInt(value) : null

class EntriesCache {
  constructor (redisOpts = {}) {
    this.store = redis.createClient(redisOpts)
  }

  get (key) {
    return new Promise((resolve, reject) => {
      this.store.get(key, (err, reply) => {
        if (err) reject(err)
        resolve(decode(reply))
      })
    })
  }

  async set (key, value) {
    this.store.set(key, encode(value))
  }
}

module.exports = EntriesCache
