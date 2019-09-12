const Pubsub = require('orbit-db-pubsub')

// TODO Using redis locally, but allow interface to consume any pubsub infra after
// TODO allow as option to exported func to configure from node startup
const redis = require("redis")
const redisOpts = { host: 'redis'}
const messageClient = redis.createClient(redisOpts)
const messageClientPub = redis.createClient(redisOpts)

// set server ids and ignore messages from own client
const NODE_ID = process.env.NODE_ID

class MessageBroker extends Pubsub {

  async subscribe(topic, onMessageCallback, onNewPeerCallback) {
    messageClient.subscribe(topic)
    messageClient.on("message", (channel, message) => {
      // TODO hacky for not registering multiple times, but will register global channel/listener instances after instead
      if (channel === topic) {
        if (JSON.parse(message).node_id !== NODE_ID ) {
          // console.log('On MESSAGE REDIS ---------')
          // console.log(channel + ": " + message);
          onMessageCallback(channel, JSON.parse(message).heads)
          super.publish(channel, JSON.parse(message).heads)
        }
      }
    })

    const onMessageWrap = (address, heads) => {
      // console.log('On MESSAGE PUBSUB ---------')
      // console.log(JSON.stringify({node_id: NODE_ID, heads}))
      messageClientPub.publish(address, JSON.stringify({node_id: NODE_ID, heads}))
      onMessageCallback(address, heads)
    }

    const onNewPeerWrap = (address, peer) => {
      onNewPeerCallback(address, peer, onMessageWrap)
    }

    super.subscribe(topic, onMessageWrap, onNewPeerWrap)
  }

}

module.exports =  MessageBroker
