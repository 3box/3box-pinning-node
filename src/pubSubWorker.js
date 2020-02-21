const EventEmitter = require('events')
const util = require('util')
const _ = require('lodash')
const uuidv4 = require('uuid/v4')

const Pubsub = require('./orbitPubSubExt')

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Given an ipfs or ipfs client instantiation, this will coordinate with other workers
// through ipfs/orbitdb pubsub to attempt to run each task exactly once according to a customizable
// priority. Load balancing could be achieved by using # of dbs open, active connections, load, etc.

class PubSubWorker {
  /**
   * The canonical way to instantiate a PubSubWorker
   * @param  {IPFS|ipfsClient} ipfs - The ipfs instance to use for pubsub
   * @param  {string} coordinationTopic - The topic name to use for worker coordination messages
   * @param  {Object} [options]
   * @param  {Number} [options.workerId] - The unique worker identifier. If not set, generates a new
   *    uuid
   * @param  {Number} [options.ackDeadline] - The amount of time (in ms) to wait for other workers
   *    to acknowledge the task before starting processing. This should balance delay in processing
   *    a task with ensuring all workers process claims in the same order.
   * @param  {Number} [options.ackJitter] - The ratio of maximum random additional time to add to
   *    the ackDeadline, used to minimize chances of workers all responding at the same time
   * @param  {Number} [options.processingDeadline] - The time limit given to a worker to complete a
   *    task. Once elapsed, the next claim will be processed.
   * @param  {Number} [options.channelLatencyAllowance] - The time allowance to process all
   *    coordination message for a task. This can be more generous than ackDeadline, as otherwise
   *    entire messages could be ignored, leading to inconsistent state across workers. However,
   *    longer allowances will keep resources open for longer.
   * @return {PubSubWorker}
   */
  static async create (...args) {
    const worker = new PubSubWorker(...args)
    await worker.start()
    return worker
  }

  constructor (ipfs, coordinationTopic, { workerId, ackDeadline = 500, ackJitter = 0.2, processingDeadline = 5000, channelLatencyAllowance = 2000 } = {}) {
    this.ipfs = ipfs
    this.workerId = workerId || uuidv4()
    this.coordinationTopic = coordinationTopic
    this.ackDeadline = ackDeadline
    this.processingDeadline = processingDeadline
    this.channelLatencyAllowance = channelLatencyAllowance
    this.ackJitter = ackJitter
    this.taskQueues = {}
    this._undefinedTasks = {}
  }

  async start () {
    console.log('Starting PubSubWorker', this.workerId)
    const ipfsId = await this.ipfs.id()
    this.pubsub = new Pubsub(this.ipfs, ipfsId.id, { processOwn: true })
    await this.pubsub.subscribe(this.coordinationTopic, this._onCoordinationMessage.bind(this), this._onNewPeer.bind(this))
  }

  async stop () {
    console.log('Stopping PubSubWorker', this.workerId)
    await this.pubsub.disconnect()
  }

  /**
   * Announce a task, to be processed by this or another worker
   * @param  {string} taskId - A unique identifier for the task. Must be consistent across workers
   * @param  {function} taskFn - The function to call to execute the task
   * @param  {Object} options
   * @param  {Object} options.claimProperties - Additional properties to be added to the claim,
   *    which can then be used to prioritize claims
   * @param  {Object} options.claimOrderBy - The order in which to prioritize claims
   * @param  {string[]} options.claimOrderBy.fields - The paths of the claim objects to order by
   * @param  {string[]} options.claimOrderBy.orders - The orders in which to prioritize the fields.
   *    (possible values: 'asc', 'desc')
   */
  async announceTask (taskId, taskFn, { claimProperties, claimOrderBy = { fields: ['timestamp'], orders: ['asc'] } } = {}) {
    this.taskQueues[taskId] = {
      ACK: new PriorityQueue(claimOrderBy.fields, claimOrderBy.orders),
      PROCESSING: new PriorityQueue(claimOrderBy.fields, claimOrderBy.orders),
      COMPLETED: new PriorityQueue(claimOrderBy.fields, claimOrderBy.orders)
    }
    if (taskId in this._undefinedTasks) {
      this._undefinedTasks[taskId].emit('defined')
      delete this._undefinedTasks[taskId]
    }
    const claimsQueue = this.taskQueues[taskId]

    const claimData = {
      timestamp: Date.now(),
      taskId,
      workerId: this.workerId,
      claimProperties
    }
    this.pubsub.publish(this.coordinationTopic, {
      status: 'ACK',
      ...claimData
    })

    // Loop through the acknowledged claims until we come to our own claim
    while (true) {
      // Wait between claims to allow the worker whose claim it is to process it
      // add jitter so not all workers respond at the same time
      await delay(this.ackDeadline * (1 + (Math.random() * this.ackJitter)))

      // Check if the task is completed or already being processed
      if (claimsQueue.COMPLETED.length > 0) {
        // Done: task was completed by another worker
        break
      } else if (claimsQueue.PROCESSING.length > 0) {
        // Another worker(s) is processing the task; Let it finish/expire
        await new Promise((resolve, reject) => {
          function resolveAndCleanup () {
            claimsQueue.PROCESSING.events.removeListener('empty', resolveAndCleanup)
            claimsQueue.PROCESSING.events.removeListener('stop', resolveAndCleanup)
            resolve()
          }
          claimsQueue.PROCESSING.events.on('empty', resolveAndCleanup)
          claimsQueue.PROCESSING.events.on('stop', resolveAndCleanup)
        })
      } else {
        // No-one is processing this task yet; get the next worker in the priority queue
        let nextClaim
        try {
          nextClaim = claimsQueue.ACK.pop()
        } catch (err) {
          console.error('something has gone terribly wrong: ACK queue is empty, and we didn\'t process our own claim', { err })
          return
        }

        if (nextClaim.workerId === this.workerId) {
          // This is us, publish and process
          this.pubsub.publish(this.coordinationTopic, {
            status: 'PROCESSING',
            ...claimData,
            timestamp: Date.now()
          })

          // We don't keep the results, because we don't use it now, and this would involve more
          // message passing - implement later if needed
          await taskFn()

          this.pubsub.publish(this.coordinationTopic, {
            status: 'COMPLETED',
            ...claimData,
            timestamp: Date.now()
          })
          break
        }
        // This wasn't us - loop to check if this claim was processed by its worker
      }
    }
    // send stop event to clean up listeners
    for (const status of ['ACK', 'PROCESSING', 'COMPLETED']) {
      claimsQueue[status].stop()
    }
    // Return immediately, but delay before deleting the queue in case more coordination messages
    // come in, we at least register them
    setTimeout(() => {
      if (claimsQueue.COMPLETED.length > 1) {
        // TODO: this is an important metric to track
        console.warn(`more than one worker completed task: ${taskId}`)
      }
      delete this.taskQueues[taskId]
    }, this.channelLatencyAllowance)
  }

  async _onCoordinationMessage (topicId, data) {
    const status = data.status
    const timestamp = data.timestamp
    const taskId = data.taskId
    const workerId = data.workerId
    const claimProperties = data.claimProperties

    const claimsQueue = await this._waitForTaskQueue(taskId)

    if (status === 'ACK') {
      claimsQueue.ACK.insert({ workerId, timestamp, claimProperties })
    } else if (status === 'PROCESSING') {
      claimsQueue.ACK.removeFirstBy(claim => claim.workerId === workerId)
      claimsQueue.PROCESSING.insert({ workerId, timestamp, claimProperties })
      // Remove after processing deadline
      setTimeout(() => {
        claimsQueue.PROCESSING.removeFirstBy(claim => claim.workerId === workerId)
      }, this.processingDeadline)
    } else if (status === 'COMPLETED') {
      claimsQueue.ACK.removeFirstBy(claim => claim.workerId === workerId)
      claimsQueue.PROCESSING.removeFirstBy(claim => claim.workerId === workerId)
      claimsQueue.COMPLETED.insert({ workerId, timestamp, claimProperties })
    }
  }

  // If a message comes in for a task we don't have registered, wait for it to be created (or time
  // out)
  async _waitForTaskQueue (taskId) {
    if (!this.taskQueues[taskId]) {
      if (!this._undefinedTasks[taskId]) {
        this._undefinedTasks[taskId] = new EventEmitter()
      }
      await new Promise((resolve, reject) => {
        this._undefinedTasks[taskId].once('defined', resolve)
        setTimeout(() => {
          if (taskId in this._undefinedTasks) {
            this._undefinedTasks[taskId].off('defined', resolve)
          }
        }, this.channelLatencyAllowance)
      })
        .finally(() => delete this._undefinedTasks[taskId])
    }
    if (!this.taskQueues[taskId]) {
      throw new Error(`got coordination msg for task that doesn't have a queue: ${taskId}`)
    }
    return this.taskQueues[taskId]
  }

  async _onNewPeer (topic, peer) {
    console.log('new peer joined coordination topic', { topic, peer })
  }
}

// Simple priority queue that orders items by fields
// Follows interface used by lodash orderBy: https://lodash.com/docs/4.17.15#orderBy
class PriorityQueue {
  constructor (fields, orders) {
    this._items = []
    this._comparator = PriorityQueue._comparatorByFields(fields, orders)
    this.events = new EventEmitter()
  }

  insert (item) {
    let index = this._items.findIndex(it => this._comparator(item, it))
    if (index === -1) {
      index = this._items.length
    }
    this._items.splice(index, 0, item)
    return this._items.length - 1
  }

  pop () {
    if (this._items.length === 0) {
      throw new Error('no items in queue')
    }
    const result = this._items.shift()
    if (this._items.length === 0) {
      this.events.emit('empty')
    }
    return result
  }

  removeFirstBy (predicate) {
    const index = this._items.findIndex(predicate)
    if (index !== -1) {
      const removed = this._items.splice(index, 1)
      if (this._items.length === 0) {
        this.events.emit('empty')
      }
      return removed[0]
    }
  }

  get length () {
    return this._items.length
  }

  inspect (depth, opts) {
    return util.inspect(this._items)
  }

  stop () {
    this.events.emit('stop')
  }

  static _comparatorByFields (fields, orders) {
    // Add tie breaker to make sure all workers have the same ordering
    fields = [...fields, 'workerId']
    orders = [...orders, 'asc']
    return function (a, b) {
      for (const [field, order] of _.zip(fields, orders)) {
        const valA = _.get(a, field)
        const valB = _.get(b, field)
        if (valA !== valB) {
          if (order === 'asc') {
            return valA < valB
          } else if (order === 'desc') {
            return valA > valB
          } else {
            throw new Error(`Unexpected order value: '${order}'`)
          }
        }
      }
      // Default - would only get here if all fields including workerId are identical
      return true
    }
  }
}

module.exports = {
  createWorker: PubSubWorker.create,
  PubSubWorker
}
