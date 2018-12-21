const redis = require('redis')

const DAYS30 = 2592000

/**
  *  RedisCache Representation. Wrapped redis client. Read, write, and invalidate objects.
  */
class RedisCache {
  constructor (redisOpts = {}, ttl) {
    this.redis = redis.createClient(redisOpts)
    this.redis.on('error', function (err) {
      console.log('Error ' + err)
    })
    this.ttl = ttl || DAYS30
  }

  read (key) {
    return new Promise((resolve, reject) => {
      this.redis.get(key, (err, val) => {
        if (err) console.log(err)
        resolve(err ? null : JSON.parse(val))
      })
    })
  }

  write (key, obj) {
    this.redis.set(key, JSON.stringify(obj), 'EX', this.ttl)
  }

  invalidate (key) {
    this.redis.del(key)
  }
}

module.exports = RedisCache
