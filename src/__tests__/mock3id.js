const didJWT = require('did-jwt')

test('', () => {})

const mock3id = {
  DID: 'did:3:asdfasdf',
  getKeyringBySpaceName: () => {
    return {
      getPublicKeys: () => {
        return { signingKey: '044f5c08e2150b618264c4794d99a22238bf60f1133a7f563e74fcf55ddb16748159872687a613545c65567d2b7a4d4e3ac03763e1d9a5fcfe512a371faa48a781' }
      }
    }
  },
  signJWT: payload => {
    return didJWT.createJWT(payload, {
      signer: didJWT.SimpleSigner('95838ece1ac686bde68823b21ce9f564bc536eebb9c3500fa6da81f17086a6be'),
      issuer: 'did:3:asdfasdf'
    })
  }
}

// we need to have a fake 3id resolver since we have a fake 3id
const getMock3idResolver = () => ({
  '3': () => ({
    '@context': 'https://w3id.org/did/v1',
    id: 'did:3:asdfasdf',
    publicKey: [{
      id: 'did:3:asdfasdf#signingKey',
      type: 'Secp256k1VerificationKey2018',
      publicKeyHex: '044f5c08e2150b618264c4794d99a22238bf60f1133a7f563e74fcf55ddb16748159872687a613545c65567d2b7a4d4e3ac03763e1d9a5fcfe512a371faa48a781'
    }],
    authentication: [{
      type: 'Secp256k1SignatureAuthentication2018',
      publicKey: 'did:3:asdfasdf#signingKey'
    }]
  })
})

module.exports = {
  mock3id,
  getMock3idResolver
}
