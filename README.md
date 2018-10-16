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
