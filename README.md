# qubic-lrv (lite record verification)

Uses spectrum digest and 451 quorum ticks to verify records.
Only `RESPOND_ENTITY` is supported now. Support for assets and contracts will be added later.

> ***DISCLAIMER:** This is untested software, probably there are several bugs.*

## Usage
```bash
git clone https://github.com/computor-tools/qubic-lrv && cd qubic-lrv
```

### Run test

Use comma separated IP addresses to specify `PUBLIC_PEERS`. Good results were produced with 4 peers.

```bash
PUBLIC_PEERS='' bun run test.js
```

```bash
PUBLIC_PEERS='' node test.js
```

### Networking

TCP connection with [full nodes](https://github.com/qubic/core) is implemented.
Websocket and WebRTC connections are planned.

### Example
```JS
const client = createClient();

await client.subscribe({ id: ARBITRATOR });

client.addListener('epoch', (epoch) => console.log('Epoch:', epoch)); // client mixes EventEmitter
client.addListener('tick', (tick) => console.log('Tick:', tick));
client.addListener('entity', (entity) => console.log('Entity:', entity.publicKey, entity));

client.connect([
    '?.?.?.?', // replace with full node addresses
    '?.?.?.?',
    '?.?.?.?',
    '?.?.?.?',
]);
```

---

This project was created using `bun init` in bun v1.0.20. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## License
Come-from-Beyond's Anti-military license.

