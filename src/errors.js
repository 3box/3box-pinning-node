const InvalidInputError = (message) => {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

const ProfileNotFound = (message) => {
  const err = new Error(message)
  err.statusCode = 404
  return err
}

const InvalidDIDFormat = (did) => {
  const err = new Error(`Invalid DID Format, expected "did:muport:Qm....", got: ${did}`)
  err.statusCode = 400
  return err
}

module.exports = {
  InvalidInputError,
  ProfileNotFound,
  InvalidDIDFormat
}
