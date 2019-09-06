const Pubsub = require('orbit-db-pubsub')


class MessageBroker extends Pubsub {

  async subscribe(topic, onMessageCallback, onNewPeerCallback) {

    // TODO (receive update from message broker)
    //  Subscribe to given topic with our internal message broker
    //  Register on message callback with subscription, and parse the same orbit already does to return heads, before calling

    // Below, still receive updates from normal pubsub ops, but now relay to topic in internal message broker as well
    const onMessageWrap = (address, heads) => {
      // TODO
      // push/write this message logged below to our broker
      console.log(JSON.stringify(heads))
      onMessageCallback(address, heads)
    }

    const onNewPeerWrap = (address, peer) => {
      onNewPeerCallback(address, peer, onMessageWrap)
    }

    super.subscribe(topic, onMessageWrap, onNewPeerWrap)
  }
}


module.exports =  MessageBroker
