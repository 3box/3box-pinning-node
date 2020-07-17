const express = require('express')
const os = require('os-utils')

const { createLogger } = require('./logger')

const HEALTH_CPU_LIMIT_PERCENT = (process.env.HEALTH_CPU_LIMIT || 50) / 100
// Temporarily Low Default, Mem Leak
const HEALTH_MEM_LIMIT_PERCENT = (process.env.HEALTH_MEM_LIMIT || 20) / 100

class HealthcheckService {
  constructor (pinning, port) {
    this.pinning = pinning
    this.port = port
    this.logger = createLogger({ name: 'healthcheckService' })
    this.app = express()
    this.app.get('/healthcheck', this.healthcheckHandler.bind(this))
  }

  async healthcheckHandler (req, res, next) {
    if (!this.pinning.ipfs.isOnline()) {
      return res.status(503).send()
    }

    const cpu = 1 - (await new Promise((resolve, reject) => os.cpuFree(resolve)))
    const mem = 1 - os.freememPercentage()

    if (cpu > HEALTH_CPU_LIMIT_PERCENT || mem > HEALTH_MEM_LIMIT_PERCENT) {
      return res.status(503).send()
    }
    return res.status(200).send()
  }

  start () {
    this.app.listen(this.port, () => this.logger.info(`Serving /healthcheck on port ${this.port}`))
  }
}

module.exports = HealthcheckService
