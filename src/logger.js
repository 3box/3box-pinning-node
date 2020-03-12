const bunyan = require('bunyan')

const defaultOptions = {
  codeVersion: process.env.CODE_VERSION
}

module.exports.createLogger = (opts) => bunyan.createLogger(Object.assign({}, defaultOptions, opts))
