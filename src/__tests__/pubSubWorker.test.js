const { PubSubWorker } = require('../pubSubWorker')

const IPFS = require('ipfs')
const _ = require('lodash')
const tmp = require('tmp-promise')
const uuidv4 = require('uuid/v4')
tmp.setGracefulCleanup()

// The following can be adjusted to test with different number of workers, or to adjust timing
// parameters

const nWorkers = 10 // At least 3 for tests to pass correctly as written

const workerOpts = {
  ackDeadline: 150, // this should be greater than combined network delays to ensure consistent queues
  // ackJitter: 0.2,
  // processingDeadline: 2000,
  channelLatencyAllowance: 500 // this should be greater than combined network delays
}

// Simulate network delays
const taskAnnounceMaxDelay = 50 // Maximum delay in starting workers usually from external messaging
const coordinationMaxDelay = 50 // Maximum delay in worker coordination channel

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Takes a snapshot (static copy) of the worker queues that can be used for comparison later
const snapshotWorkerQueues = (worker) => {
  const snapshot = {}
  for (const taskId in worker.taskQueues) {
    snapshot[taskId] = {}
    for (const status in worker.taskQueues[taskId]) {
      snapshot[taskId][status] = _.cloneDeep(worker.taskQueues[taskId][status]._items)
    }
  }
  return snapshot
}

describe('pubSubWorker', () => {
  let tmpDir
  let ipfs
  const coordinationTopic = 'test-coordination-topic'
  let workers

  beforeAll(async () => {
    tmpDir = await tmp.dir({ unsafeCleanup: true })
    ipfs = await IPFS.create({ repo: tmpDir.path })
  })

  afterAll(async () => {
    tmpDir.cleanup()
    await ipfs.stop()
  })

  beforeEach(async () => {
    workers = Array(nWorkers).fill().map(() => new PubSubWorker(ipfs, coordinationTopic, workerOpts))
    // Monkeypatch workers to simulate network delay
    workers.forEach((worker) => {
      const originalAnnouceFn = worker.announceTask.bind(worker)
      worker.announceTask = async (...args) => {
        await delay(Math.random() * taskAnnounceMaxDelay)
        return originalAnnouceFn(...args)
      }
      const originalCoordinationFn = worker._onCoordinationMessage.bind(worker)
      worker._onCoordinationMessage = async (...args) => {
        await delay(Math.random() * coordinationMaxDelay)
        return originalCoordinationFn(...args)
      }
    })
    await Promise.all(workers.map(worker => worker.start()))
    expect.hasAssertions()
  })

  afterEach(async () => {
    await Promise.all(workers.map(async worker => worker.stop()))
  })

  it('should only process each task once', async () => {
    expect.assertions(1)
    const taskId = uuidv4()
    const taskFn = jest.fn(() => delay(500))

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn)))

    expect(taskFn).toHaveBeenCalledTimes(1)
  })

  it('should have identical queues amongst workers before they begin processing', async () => {
    expect.assertions(nWorkers - 1)
    const taskId = uuidv4()
    const taskFn = () => delay(500)

    const afterAckWorkerSnapshotsPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve(workers.map(snapshotWorkerQueues))
      }, workers[0].ackDeadline)
    })

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn)))

    const afterAckWorkerSnapshots = await afterAckWorkerSnapshotsPromise
    afterAckWorkerSnapshots.slice(1).forEach((queue) => {
      expect(queue).toEqual(afterAckWorkerSnapshots[0])
    })
  })

  it('should have identical queues amongst workers after the task has been completed', async () => {
    expect.assertions(nWorkers - 1)
    const taskId = uuidv4()
    const taskFn = () => delay(500)

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn)))

    const afterCompletedWorkerSnapshots = workers.map(snapshotWorkerQueues)
    afterCompletedWorkerSnapshots.slice(1).forEach((queue) => {
      expect(queue).toEqual(afterCompletedWorkerSnapshots[0])
    })
  })

  it('should run on the worker that responds first if none have the db open', async () => {
    expect.assertions(nWorkers)
    const taskId = uuidv4()
    const taskFn = () => delay(500)
    workers.forEach((worker) => {
      worker.runTaskOpts = {
        claimProperties: {
          hasDbOpen: false
        },
        claimOrderBy: {
          fields: ['hasDbOpen', 'timestamp'],
          orders: ['desc', 'asc']
        }
      }
    })
    // Need to get the ack timestamp from the snapshots because we only keep the latest state
    // update timestamp in the queue
    const afterAckWorkerSnapshotsPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve(workers.map(snapshotWorkerQueues))
      }, workers[0].ackDeadline)
    })

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn, worker.runTaskOpts)))

    // Here we assume all queues are the same, as tested above
    const afterAckWorkerSnapshots = await afterAckWorkerSnapshotsPromise
    const completedClaim = workers[0].taskQueues[taskId].COMPLETED._items[0]
    const completedClaimAckTime = afterAckWorkerSnapshots[0][taskId].ACK.find(claim => claim.workerId === completedClaim.workerId).timestamp
    afterAckWorkerSnapshots[0][taskId].ACK.forEach((claim) => {
      expect(completedClaimAckTime).toBeLessThanOrEqual(claim.timestamp)
    })
  })

  it('should run on the worker that has the db open if only one does', async () => {
    expect.assertions(1)
    const taskId = uuidv4()
    const taskFn = () => delay(500)
    workers.forEach((worker) => {
      worker.runTaskOpts = {
        claimProperties: {
          hasDbOpen: false
        },
        claimOrderBy: {
          fields: ['claimProperties.hasDbOpen', 'timestamp'],
          orders: ['desc', 'asc']
        }
      }
    })
    const randomWorker = _.sample(workers)
    randomWorker.runTaskOpts.claimProperties.hasDbOpen = true

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn, worker.runTaskOpts)))

    const completedClaim = workers[0].taskQueues[taskId].COMPLETED._items[0]
    console.log(workers[0].taskQueues[taskId].COMPLETED._items)
    expect(completedClaim.workerId).toEqual(randomWorker.workerId)
  })

  it('should run on the worker that has the db open and responds first if several have the db open', async () => {
    expect.assertions(nWorkers * 2)
    const taskId = uuidv4()
    const taskFn = () => delay(500)
    workers.forEach((worker) => {
      worker.runTaskOpts = {
        claimProperties: {
          hasDbOpen: false
        },
        claimOrderBy: {
          fields: ['claimProperties.hasDbOpen', 'timestamp'],
          orders: ['desc', 'asc']
        }
      }
    })
    const randomWorkers = _.sampleSize(workers, _.random(2, nWorkers - 1))
    randomWorkers.forEach(worker => {
      worker.runTaskOpts.claimProperties.hasDbOpen = true
    })
    // Need to get the ack timestamp from the snapshots because we only keep the latest state
    // update timestamp in the queue
    const afterAckWorkerSnapshotsPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve(workers.map(snapshotWorkerQueues))
      }, workers[0].ackDeadline)
    })

    await Promise.all(workers.map(async worker => worker.announceTask(taskId, taskFn, worker.runTaskOpts)))

    // Here we assume all queues are the same, as tested above
    const afterAckWorkerSnapshots = await afterAckWorkerSnapshotsPromise
    const completedClaim = workers[0].taskQueues[taskId].COMPLETED._items[0]
    const completedClaimAckTime = afterAckWorkerSnapshots[0][taskId].ACK.find(claim => claim.workerId === completedClaim.workerId).timestamp
    afterAckWorkerSnapshots[0][taskId].ACK.forEach((claim) => {
      expect(completedClaim.claimProperties.hasDbOpen).toBeTruthy()
      expect(!claim.claimProperties.hasDbOpen || completedClaimAckTime <= claim.timestamp).toBeTruthy()
    })
  })
})
