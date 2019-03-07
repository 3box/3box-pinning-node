const S3Store = require('datastore-s3')

const ipfsRepo = (config) => {
  const { path, bucket, accessKeyId, secretAccessKey } = config

  return S3Store.createRepo({
    path
  }, {
    bucket,
    accessKeyId,
    secretAccessKey
  })
}

module.exports = { ipfsRepo }
