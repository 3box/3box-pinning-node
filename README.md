[![Twitter Follow](https://img.shields.io/twitter/follow/3boxdb.svg?style=for-the-badge&label=Twitter)](https://twitter.com/3boxdb)
[![Discord](https://img.shields.io/discord/484729862368526356.svg?style=for-the-badge)](https://discordapp.com/invite/Z3f3Cxy)

# 3Box pinning server

The pinning server is an ipfs and orbit-db node that persists the data of 3box users.

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
