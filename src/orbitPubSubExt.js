const OrbitDbPubsub = require('orbit-db-pubsub')

/*
 *  Extends orbit-db-pubsub to include the message id, as well as provide a configurable
 *  option on whether we want to process the ipfs node's own messages or not (orbit-db-pubsub
 *  doesn't process an ipfs node's own messages). This is needed in cases where multiple ipfs
 *  clients connect to the same ipfs node, and would like to use pubsub to communicate with
 *  each other.
 */

class Pubsub extends OrbitDbPubsub {
  constructor (ipfs, id, { processOwn = false } = {}) {
    super(ipfs, id)
    this._processOwn = processOwn
  }

  async subscribe (topic, onMessageCallback, onNewPeerCallback = () => undefined) {
    return super.subscribe(topic, onMessageCallback, onNewPeerCallback)
  }

  async _handleMessage (message) {
    // Check if we should process our own messages
    if (!this._processOwn && message.from === this._id) { return }

    // Get the message content and a subscription
    let content, subscription, topicId, seqno
    try {
      // Get the topic
      topicId = message.topicIDs[0]
      content = JSON.parse(message.data)
      subscription = this._subscriptions[topicId]
      seqno = message.seqno.toString('base64')
    } catch (error) {
      console.error('Couldn\'t parse pubsub message:', { message, error })
    }

    if (subscription && subscription.onMessage && content) {
      await subscription.onMessage(topicId, content, message.from, seqno)
    }
  }
}

module.exports = Pubsub
