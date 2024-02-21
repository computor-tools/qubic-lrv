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

import { exec } from 'node:child_process';
import * as qubic from './src/client.js';

const test = async function ({ pingPongAmount }) {
    if (process.env.PEERS === undefined) {
        await exec(`echo "epoch=0" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "tick=0" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "color=E43" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "status=failing" >> "$GITHUB_OUTPUT"`);
        console.log('Expected PEERS env var. Test failed!');
        process.exit(1);
    }

    const system = {
        epoch: 0,
        tick: 0,
    };

    const client = qubic.createClient();

    client.addListener('epoch', (epoch) => console.log('Epoch:', (system.epoch = epoch.epoch)));

    client.addListener('tick', (tick) => console.log('\nTick  :', (system.tick = tick.tick), tick.spectrumDigest, tick.universeDigest, tick.computerDigest));
    client.addListener('tick_stats', (stats) => console.log('Stats :', stats.tick, '(' + stats.numberOfSkippedTicks.toString() + ' skipped)', stats.duration.toString() + 'ms,', stats.numberOfUpdatedEntities, 'entities updated', stats.numberOfSkippedEntities, 'skipped,', stats.numberOfClearedTransactions, 'txs cleared'));

    client.addListener('error', (error) => console.log(error));

    client.connect((process.env.PEERS).split(',').map(s => s.trim())); // start the loop by listening to networked messages

    if (process.env.SEED?.length) {
        let transaction;

        const privateKeys = {
            Alice: await qubic.createPrivateKey(process.env.SEED, 0),
            Bob: await qubic.createPrivateKey(process.env.SEED, 1),
        };

        const Alice = await client.createEntity(privateKeys.Alice);
        const Bob = await client.createEntity(privateKeys.Bob);

        client.addListener('transfer', async function (transfer) {
            console.log('Transfer:', transfer);

            if (transfer.executed) {
                await exec(`echo "epoch=${system.epoch}" >> "$GITHUB_OUTPUT"`);
                await exec(`echo "tick=${system.tick}" >> "$GITHUB_OUTPUT"`);
                await exec(`echo "color=3C1" >> "$GITHUB_OUTPUT"`);
                await exec(`echo "status=passing" >> "$GITHUB_OUTPUT"`);
                console.log('PASSED');
                process.exit(0);
            } else { // retry tx
                try {
                    const privateKey = transaction.sourceId === Alice.id ? privateKeys.Alice : privateKeys.Bob;
                    const source = transaction.sourceId === Alice.id ? Alice : Bob;

                    transaction = await source.createTransaction(
                        privateKey,
                        {
                            destinationId: transaction.destinationId,
                            amount: transaction.amount,
                            tick: await source.executionTick(),
                        }
                    );
                    source.broadcastTransaction();

                    console.log('Tx:', transaction.digest, transaction.tick);
                } catch (error) {
                    console.log('Error:', error.message);
                }
            }
        });

        client.addListener('entity', async function (entity) {
            console.log('Entity:', entity.tick, entity.spectrumDigest, entity.id, entity.energy);

            if (transaction === undefined) {
                if (entity.energy >= pingPongAmount) {
                    const privateKey = entity.id === Alice.id ? privateKeys.Alice : privateKeys.Bob;
                    const source = entity.id === Alice.id ? Alice : Bob;

                    try {
                        const transaction = await source.createTransaction(
                            privateKey,
                            {
                                destinationId: source.id === Alice.id ? Bob.id : Alice.id,
                                amount: pingPongAmount,
                                tick: await source.executionTick(), // request suitable execution tick
                            }
                        );
                        source.broadcastTransaction(); // broadcasts the latest non-processed transaction

                        console.log('Tx:', transaction.digest, transaction.tick);
                    } catch (error) {
                        console.log('Error:', error.message);
                    }
                }
            }
        });
    } else {
        await exec(`echo "epoch=0" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "tick=0" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "color=E43" >> "$GITHUB_OUTPUT"`);
        await exec(`echo "status=failing" >> "$GITHUB_OUTPUT"`);
        console.log('Expected seed. Test failed!');
        process.exit(1);
    }
};

test({
    pingPongAmount: 1000n,
});
