/*

Permission is hereby granted, perpetual, worldwide, non-exclusive, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), 
to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, 
and to permit persons to whom the Software is furnished to do so, subject to the following conditions:


1. The Software cannot be used in any form or in any substantial portions for development, maintenance and for any other purposes, in the military sphere and in relation to military products, 
including, but not limited to:

    a. any kind of armored force vehicles, missile weapons, warships, artillery weapons, air military vehicles (including military aircrafts, combat helicopters, military drones aircrafts), 
    air defense systems, rifle armaments, small arms, firearms and side arms, melee weapons, chemical weapons, weapons of mass destruction;

    b. any special software for development technical documentation for military purposes;

    c. any special equipment for tests of prototypes of any subjects with military purpose of use;

    d. any means of protection for conduction of acts of a military nature;

    e. any software or hardware for determining strategies, reconnaissance, troop positioning, conducting military actions, conducting special operations;

    f. any dual-use products with possibility to use the product in military purposes;

    g. any other products, software or services connected to military activities;

    h. any auxiliary means related to abovementioned spheres and products.


2. The Software cannot be used as described herein in any connection to the military activities. A person, a company, or any other entity, which wants to use the Software, 
shall take all reasonable actions to make sure that the purpose of use of the Software cannot be possibly connected to military purposes.


3. The Software cannot be used by a person, a company, or any other entity, activities of which are connected to military sphere in any means. If a person, a company, or any other entity, 
during the period of time for the usage of Software, would engage in activities, connected to military purposes, such person, company, or any other entity shall immediately stop the usage 
of Software and any its modifications or alterations.


4. Abovementioned restrictions should apply to all modification, alteration, merge, and to other actions, related to the Software, regardless of how the Software was changed due to the 
abovementioned actions.


The above copyright notice and this permission notice shall be included in all copies or substantial portions, modifications and alterations of the Software.


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH 
THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

'use strict'

import * as qubic from './src/client.js';
import { CONTRACTS } from './src/constants.js';
import { NULL_ID_STRING } from './src/converter.js';
import { MIN_NUMBER_OF_PUBLIC_PEERS } from './src/transceiver.js';

const test = async function ({ seed, pingPongAmount }) {
    if (process.env.PUBLIC_PEERS === undefined) {
        console.log('Error: Define PUBLIC_PEERS env var.');
        process.exit(1);
    }

    const client = qubic.createClient();

    await client.subscribe({ id: qubic.ARBITRATOR }); // subscribe to arbitrary id

    client.addListener('epoch', (epoch) => console.log('\n  Epoch:', epoch.epoch));
    client.addListener('tick', (tick) => console.log('\n   Tick:', tick.tick, "\x1b[2m" + tick.spectrumDigest, tick.universeDigest, tick.computerDigest + "\x1b[0m"));
    client.addListener('entity', (entity) => {
        if (entity.outgoingTransfer !== undefined) {
            console.log(' Entity:', entity.tick, entity.spectrumDigest, entity.id, entity.energy, entity.outgoingTransfer.digest, entity.outgoingTransfer.tick, 'executed:', entity.outgoingTransfer.executed);
        } else {
            console.log(' Entity:', entity.tick, entity.id + ':', entity.energy, "\x1b[2m" + entity.spectrumDigest + "\x1b[0m");
        }
    });
    client.addListener('asset', async (asset) => {
        console.log('  Asset:', asset.tick, asset.ownership.ownerId + ':', asset.ownership.numberOfShares, asset.issuance.name, 'shares,', 'issued by', (asset.issuance.issuerId === await NULL_ID_STRING ? 'QUORUM' : asset.issuance.issuerId) + ',', 'managed by #' + asset.ownership.managingContractIndex + '-' + CONTRACTS[asset.ownership.managingContractIndex], "\x1b[2m" + asset.universeDigest + "\x1b[0m");
    });
    client.addListener('transfer', (transfer) => console.log(' Transfer:', transfer));

    let networkStats = { publicPeers: [], peers: [] };
    client.addListener('tick_stats', (stats) => console.log('  Stats:', stats.tick, '(' + stats.numberOfSkippedTicks.toString() + ' skipped)', stats.duration.toString() + 'ms,', stats.numberOfUpdatedEntities, 'entities updated', stats.numberOfSkippedEntities, 'skipped,', stats.numberOfClearedTransactions, 'txs cleared,', networkStats.publicPeers.length, 'known peers', networkStats.peers.length + '/' + MIN_NUMBER_OF_PUBLIC_PEERS));
    client.addListener('network', (network) => (networkStats = network));

    client.addListener('error', (error) => console.log(error.message));

    client.connect((process.env.PUBLIC_PEERS).split(',').map(s => s.trim())); // start the loop by listening to networked messages

    if (seed.length) {
        const privateKeys = [
            await qubic.createPrivateKey(seed, 0),
            await qubic.createPrivateKey(seed, 1),
        ];
        const entity = await client.createEntity(privateKeys[0]); // creating an entity, autogenerates subscription by entity.id

        // const destinationId = (await client.createEntity(privateKeys[1])).id; // own destination

        // try {
        //     const transaction = await entity.createTransaction(
        //         privateKeys[0],
        //         {
        //             destinationId,
        //             amount: pingPongAmount,
        //             tick: await entity.executionTick(), // request suitable execution tick
        //         }
        //     );
        //     entity.broadcastTransaction(); // broadcasts the latest non-processed transaction

        //     console.log('Tx:', transaction.digest, transaction.tick);
        // } catch (error) {
        //     console.log('Error:', error.message);
        // }
    }
};

test({
    seed: '', // add a seed to test transfers
    pingPongAmount: 1000n,
});