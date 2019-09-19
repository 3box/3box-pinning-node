const Pubsub = require('orbit-db-pubsub')
const redis = require('redis')

const createMessage = (heads, id) => JSON.stringify({ from: id, heads })
const messageParse = (message) => JSON.parse(message)

class MessageBroker extends Pubsub {
  constructor (ipfs, id, instanceId, redisOpts, onMessageCallback) {
    super(ipfs, id)
    this._topics = {}
    this.instanceId = instanceId
    this.onMessageCallback = onMessageCallback
    this.messageClientSub = redis.createClient(redisOpts)
    this.messageClientPub = redis.createClient(redisOpts)
    this.messageClientSub.on('message', this.messageHandler.bind(this))
  }

  async subscribe (topic, onMessageCallback, onNewPeerCallback) {
    this.messageClientSub.subscribe(topic)
    super.subscribe(topic, onMessageCallback, onNewPeerCallback)
  }

  async unsubscribe (topic) {
    this.messageClientSub.unsubscribe(topic)
    super.unsubscribe(topic)
  }

  messageHandler (topic, rawMessage) {
    const message = messageParse(rawMessage)
    if (message.from === this.instanceId) return
    this.onMessageCallback(topic, message.heads)
    super.publish(topic, message.heads)
  }

  onMessageWrap (address, heads) {
    this.messageClientPub.publish(address, createMessage(heads, this.instanceId))
    this.onMessageCallback(address, heads)
  }
}

module.exports = MessageBroker
