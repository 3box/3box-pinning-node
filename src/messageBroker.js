const Pubsub = require('orbit-db-pubsub')

// TODO Using redis locally, but allow interface to consume any pubsub infra after
// TODO allow as option to exported func to configure from node startup
const redis = require("redis")
const redisOpts = { host: 'redis'}
const messageClient = redis.createClient(redisOpts)
const messageClientPub = redis.createClient(redisOpts)

// set server ids and ignore messages from own client
const NODE_ID = process.env.NODE_ID
const createMessage = (heads) => JSON.stringify({node_id: NODE_ID, heads})
const messageParse = (message) => JSON.parse(message)

class MessageBroker extends Pubsub {
  constructor (ipfs, id) {
    super(ipfs, id)
    this._topics = {}
    messageClient.on("message", this.messageHandler.bind(this))
  }

  async subscribe(topic, onMessageCallback, onNewPeerCallback) {
    if (!this._topics[topic]) {
      messageClient.subscribe(topic)
      this._topics[topic] = { onMessageCallback }  // TODO this is always same cb right now? but should still bind per tpic
    }

    const onMessageWrap = (address, heads) => {
      // console.log('On MESSAGE PUBSUB ---------')
      // console.log(JSON.stringify({node_id: NODE_ID, heads}))
      messageClientPub.publish(address, createMessage(heads))
      onMessageCallback(address, heads)
    }

    const onNewPeerWrap = (address, peer) => {
      onNewPeerCallback(address, peer, onMessageWrap)
    }

    super.subscribe(topic, onMessageWrap, onNewPeerWrap)
  }

  async unsubscribe(topic) {
    messageClient.unsubscribe(topic)
    super.unsubscribe(topic)
  }

  messageHandler (topic, rawMessage) {
    if (!this._topics[topic]) return
    const message = messageParse(rawMessage)
    if (message.node_id === NODE_ID ) return
    // console.log('On MESSAGE REDIS ---------')
    // console.log(channel + ": " + message);
    this._topics[topic].onMessageCallback(topic, message.heads)
    super.publish(topic, message.heads)
  }
}

module.exports =  MessageBroker
