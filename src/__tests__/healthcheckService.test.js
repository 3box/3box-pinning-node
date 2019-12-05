const HealthcheckService = require('../healthcheckService')
const request = require('supertest')
const { cpuFree: cpuFreeMock, freememPercentage: freememPercentageMock } = require('os-utils')

jest.mock('os-utils', () => {
  return {
    cpuFree: jest.fn(),
    freememPercentage: jest.fn()
  }
})

describe('HealthcheckService', () => {
  const HEALTHCHECK_PORT = 8000
  const pinning = { ipfs: { isOnline: () => {} } }
  const healthcheckService = new HealthcheckService(pinning, HEALTHCHECK_PORT)
  let isOnlineMock

  beforeEach(() => {
    isOnlineMock = jest.spyOn(pinning.ipfs, 'isOnline').mockReturnValue(true)
    cpuFreeMock.mockImplementation(cb => cb(0.8)) // eslint-disable-line standard/no-callback-literal
    freememPercentageMock.mockReturnValue(0.8)
  })

  afterEach(() => {
    jest.resetModules()
    isOnlineMock.mockRestore()
  })

  it('should return a failure if IPFS isn\'t online', async (done) => {
    isOnlineMock.mockReturnValue(false)

    request(healthcheckService.app)
      .get('/healthcheck')
      .expect(503)
      .end(done)
  })

  it('should return a failure on low cpu', async (done) => {
    cpuFreeMock.mockImplementation(cb => cb(0.01)) // eslint-disable-line standard/no-callback-literal

    request(healthcheckService.app)
      .get('/healthcheck')
      .expect(503)
      .end(done)
  })

  it('should return a failure on low memory', async (done) => {
    freememPercentageMock.mockReturnValue(0.01)

    request(healthcheckService.app)
      .get('/healthcheck')
      .expect(503)
      .end(done)
  })

  it('should return a succes if memory, cpu and IPFS status are OK', async (done) => {
    request(healthcheckService.app)
      .get('/healthcheck')
      .expect(200)
      .end(done)
  })
})
