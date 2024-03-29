# qubic-lrv (lite record verification)

[![test](.github/badges/test.svg)](https://github.com/computor-tools/qubic-lrv/actions/workflows/test.yaml)
[![Discord](https://img.shields.io/discord/768887649540243497)](https://discord.gg/qubic)

Uses spectrum digest and 451 quorum ticks to verify records.
Only `RESPOND_ENTITY` is supported now. Support for assets and contracts will be added later.

## Rationale

There are 676 computors, elected by the miners who assign useful proofs of work. Computors issue special tick transactions to reach final agreement, which is detected as soon as 451 votes are found to be aligned (excluding own vote).

Lite client verification routine collects and compares 451 votes signed by discrete computor public keys. This logic will be revisited after core is changed to rely on arb signature for faulty computors.
At least 451 prev tick votes and 451 current tick votes are compared against each other, if aligned we detect _finality_ of prev tick.

Client may receive arbitrary data from `RESOND_ENTITY` message, for this reason we use such messages to calculate merkle root. The root is compared to the corresponding prev spectrum digest aligning in 451 next tick votes.
If matching, entity data are accepted and we deduce execution status of issued transactions. Ticks can be skipped because issuance awaits status of previous transaction.

### Networking

TCP connection with [full nodes](https://github.com/qubic/core) is implemented.
Websocket and WebRTC connections are planned. WebRTC is intended to reduce bandwidth requirements for websocket servers. Servers would need to send 451 votes per tick per client.
Using pub/sub vs tcp and websocket polling to fetch entity data is also being explored.

## License
Come-from-Beyond's [**Anti-Military License**](LICENSE).

For licenses of Microsoft/FourQlib and XKCP/K12 dependencies refer to [qubic-crypto](https://github.com/computor-tools/qubic-crypto/blob/main/LICENSE) repo.

## Usage
```bash
git clone https://github.com/computor-tools/qubic-lrv && cd qubic-lrv
```
### Install dependencies
Postinstall fetches dependencies from Github ([microsoft/FourQlib](https://github.com/Microsoft/FourQlib), [XKCP/K12](https://github.com/XKCP/K12) & [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk)), executes GNU Make and emsdk executables.
Requires GNU Make to be already installed, [check CI](https://github.com/computor-tools/qubic-crypto/actions) for more info.

```
bun install --verbose
```

### Run test

Use comma separated IP addresses to specify `PUBLIC_PEERS`. Good results were produced with 4 peers.

```bash
PUBLIC_PEERS='' bun run test.js
```

```bash
PUBLIC_PEERS='' node test.js
```

### Example
```JS
const client = qubic.createClient();

// subscribe by id to receive entity events
await client.subscribe({ id: ARBITRATOR });

client.addListener('epoch', (epoch) => console.log('Epoch:', epoch.epoch));
client.addListener('tick', (tick) => console.log('Tick:', tick.tick));
client.addListener('entity', (entity) => console.log('Entity:', entity.publicKey, entity.energy));
client.addListener('error', (error) => console.log(error.message));

client.connect([
    '?.?.?.?', // replace with full node addresses
    '?.?.?.?',
    '?.?.?.?',
    '?.?.?.?',
]);
```

### Transaction issuance
> [!IMPORTANT]  
> Only one transaction can be executed per entity per tick.
>
> While transactions may be _included_ in the blockchain it is not necessarily true that they were _executed_. This is why we rely on `RESPOND_ENTITY` data, and verify the merkle proof for the _spectrum_.

> [!CAUTION]
> Sharing private keys among different client and entity instances may result in invalid data in `entity.outgoingTransaction` and `transfer` event, as well as accidental cancelation of transactions.
> Synchronize transaction issuance with additional code if your use case reuires to support multiple instances simultaneously.

To issue transaction create an entity as the source. A suitable execution tick can be used by awaiting `entity.executionTick()`, which is resolved once client is synced or after pending transaction is cleared.
This prevents accidental cancelation of pending outgoing transaction and allows client to emit `transfer` events which return execution status.

Pending outgoing transactions are stored in the filesystem, or browser's local storage. If proccess dies, or broswer page is refreshed, processing will resume normally.

Calling `entity.broadcastTransaction` broadcasts latest pending transaction to all connected peers.

### Energy transfers
To issue a transfer set `amount` field to a big integer, indicating the amount of transferred energy in qus.

```JS
const privateKey = await qubic.createPrivateKey(seed);
const entity = await client.createEntity(privateKey); // creating an entity autogenerates subscription by entity.id

entity.addListener('error', function (error) { // listen for errors
    console.log(error);
});

try {
    const transaction = await entity.createTransaction(privateKey, {
        destinationId: '', // replace with destination id, (60 uppercase latin chars to include checksum)
        amount: 0n,
        tick: await entity.executionTick(),
    });
    console.log(transaction);

    entity.broadcastTransaction();
} catch (error) {
    console.log(error.message);
}
```

> [!TIP]
> Learn if transfer was executed by subscribing to `transfer` event. You may want to create a new transaction if transfer failed in the previous one.

```JS
client.addListener('transfer', function (transfer) {
    console.log('Transfer:', transfer); // receive final state of outgoing transfers

    if (!tranfer.executed) {
        // create a new transaction if needed
        try {
            const transaction = await entity.createTransaction(privateKey, {
                destinationId: transfer.destinationId,
                amount: transfer.amount,
                tick: await entity.executionTick(),
            });
            console.log('Latest transfer failed, retrying:', transaction);

            entity.broadcastTransaction();
        } catch (error) {
            console.log(error.message);
        }
    }
});
```

### Air gap scenario

As a network security measure, it is possible to generate ids with `qubic.createId()` and sign transactions with `qubic.createTransaction` in physically isolated computer or network. Calling these methods does not require a client connected to Qubic network.
Signed transactions can be transported to a computer with internet connection and broadcasted with `client.broadcastTransaction`.
Just make sure you calculate execution tick of transaction correctly to avoid walking back-and-forth.

### Offline verification

Relevant to IoT sector, lrv could verify records while being offline. Proofs can be generated via fetching data from classic internet, later communicated to IoT agents by other means (e.g.; nfc or ble transceivers).

---

This project was created using `bun init` in bun v1.0.20. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
