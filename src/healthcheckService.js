const express = require('express')
const os = require('os-utils')

const { createLogger } = require('./logger')

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
    const cpuFree = await new Promise((resolve, reject) => os.cpuFree(resolve))
    const memFree = os.freememPercentage()
    if (cpuFree < 0.05 || memFree < 0.20) {
      return res.status(503).send()
    }
    return res.status(200).send()
  }

  start () {
    this.app.listen(this.port, () => this.logger.info(`Serving /healthcheck on port ${this.port}`))
  }
}

module.exports = HealthcheckService
