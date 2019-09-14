const Pubsub = require('orbit-db-pubsub')
const redis = require('redis')

const createMessage = (heads, id) => JSON.stringify({ from: id, heads })
const messageParse = (message) => JSON.parse(message)

class MessageBroker extends Pubsub {
  constructor (ipfs, id, instanceId, redisOpts) {
    super(ipfs, id)
    this._topics = {}
    this.instanceId = instanceId
    this.messageClientSub = redis.createClient(redisOpts)
    this.messageClientPub = redis.createClient(redisOpts)
    this.messageClientSub.on('message', this.messageHandler.bind(this))
  }

  async subscribe (topic, onMessageCallback, onNewPeerCallback) {
    if (!this._topics[topic]) {
      this.messageClientSub.subscribe(topic)
      this._topics[topic] = { onMessageCallback }
    }

    const onMessageWrap = (address, heads) => {
      console.log('On MESSAGE PUBSUB ---------')
      console.log(JSON.stringify(createMessage(heads, this.instanceId)))
      this.messageClientPub.publish(address, createMessage(heads, this.instanceId))
      onMessageCallback(address, heads)
    }

    const onNewPeerWrap = (address, peer) => {
      onNewPeerCallback(address, peer, onMessageWrap)
    }

    super.subscribe(topic, onMessageWrap, onNewPeerWrap)
  }

  async unsubscribe (topic) {
    this.messageClientSub.unsubscribe(topic)
    super.unsubscribe(topic)
  }

  messageHandler (topic, rawMessage) {
    if (!this._topics[topic]) return
    const message = messageParse(rawMessage)
    if (message.from === this.instanceId) return
    console.log('On MESSAGE REDIS ---------')
    console.log(topic + ': ' + JSON.stringify(message))
    this._topics[topic].onMessageCallback(topic, message.heads)
    super.publish(topic, message.heads)
  }
}

module.exports = (instanceId, redisOpts) => (ipfs, id) => new MessageBroker(ipfs, id, instanceId, redisOpts)
