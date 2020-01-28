[![Twitter Follow](https://img.shields.io/twitter/follow/3boxdb.svg?style=for-the-badge&label=Twitter)](https://twitter.com/3boxdb)
[![Discord](https://img.shields.io/discord/484729862368526356.svg?style=for-the-badge)](https://discordapp.com/invite/Z3f3Cxy) [![Greenkeeper badge](https://badges.greenkeeper.io/3box/3box-pinning-node.svg)](https://greenkeeper.io/)

# 3Box pinning node

The pinning node is an ipfs and orbit-db node that persists the data of 3box users.

### Requirements

- node v10
- python v2

## Run as command line tool

```bash
# Install via npm
(sudo) npm install 3box-pinning-node --global
# Install via yarn
yarn global add 3box-pinning-node
# Run node
(sudo) 3box-pinning-node
```

## Pubsub messages

#### request to pin
This message is sent from a 3box-js client when `openBox` is called.
```js
{
  type: 'PIN_DB',
  odbAddress: <orbit-db address>
}
```

#### length response
This message is sent from the pinning node as a response to `PIN_DB`.
```js
{
  type: 'HAS_ENTRIES',
  odbAddress: <orbit-db address>,
  numEntries: <the number of entries that the pinning node has for the given db>
}
```

#### replicated response
This message is sent from the pinning node when a db has been replicated.
```js
{
  type: 'REPLICATED',
  odbAddress: <orbit-db address>,
}
```

## Configuration 

Configurations for both production and development environments can be found in both `.env.production` and `.env.development` respectively. The pinning service also runs a profile caching service. This can be disabled by running (i.e. you only require the pinning node) the following command instead.

    $ (sudo) npm run start -- --runCacheService=false

The profile caching service also uses a Redis cache to cache requests. This is disabled by default in development. And can generally be disabled by not setting the env variable `REDIS_PATH`.

To only handle a subset of pinning requests, you can use the DID and space whitelist options. These are configured with the `PIN_WHITELIST_DIDS` and `PIN_WHITELIST_SPACES` environment variables, which are comma-separated lists (no whitespace between items). For example:
```
PIN_WHITELIST_DIDS=did:3:bafyreie2i5l7fttwgzluctidfgbskyx47gjl2illqmbpp3vh4axacxpkqm,did:3:bafyreigwzej3toirnjur5ur3z3qwefnmrwonhlpok5dapfmgmc2i3sv2je
PIN_WHITELIST_SPACES=abc,def
```

In addition, the PIN_SILENT environment variable can be set to `true` if the pinning node should not send responses to pin and sync requests (on private and 3rd party nodes, for example).