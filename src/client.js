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

import EventEmitter from 'events';
import crypto from './crypto/index.js';
import { CHECKPOINT } from './checkpoint.js';
import {
    ARBITRATOR,
    ARBITRATOR_BYTES,
    NUMBER_OF_COMPUTORS,
    QUORUM,
    SPECTRUM_DEPTH,
    MAX_NUMBER_OF_TICKS_PER_EPOCH,
    TARGET_TICK_DURATION,
    TICK_TRANSACTIONS_PUBLICATION_OFFSET,
    MAX_AMOUNT,
} from './constants.js'
import {
    EXCHANGE_PUBLIC_PEERS,
    BROADCAST_COMPUTORS,
    BROADCAST_TICK,
    REQUEST_COMPUTORS,
    REQUEST_QUORUM_TICK,
    BROADCAST_TRANSACTION,
    REQUEST_CURRENT_TICK_INFO,
    RESPOND_CURRENT_TICK_INFO,
    REQUEST_ENTITY,
    RESPOND_ENTITY,
    createMessage,
    createTransceiver,
    MIN_NUMBER_OF_PUBLIC_PEERS,
} from './transceiver.js';
import {
    bytes64ToString,
    stringToBytes64,
    digestBytesToString,
    bytesToId,
    idToBytes,
    bytesToBigUint64,
    bigUint64ToString,
    NULL_ID_STRING,
    shiftedHexToBytes,
    bytesToShiftedHex,
} from './converter.js';
import { isZero, equal, IS_BROWSER } from './utils.js';
import { createPrivateKey, createId, SEED_LENGTH } from './id.js';
import { TRANSACTION, createTransaction, inspectTransaction } from './transaction.js';

export {
    ARBITRATOR,
    NUMBER_OF_COMPUTORS,
    QUORUM,
    MAX_AMOUNT,
    SEED_LENGTH,
    createPrivateKey,
    createId,
    idToBytes,
    bytesToId,
    createTransaction,
    inspectTransaction,
};

const importPath = Promise.resolve(!IS_BROWSER && import('node:path'));
const importFs = Promise.resolve(!IS_BROWSER && import('node:fs'));

const STORED_ENTITIES_DIR = 'stored_entities';

const inferEpoch = function() {
    const now = new Date();
    let year =  now.getUTCFullYear() - 2000;
    let month = now.getUTCMonth() + 1;

    const days = Math.floor(year += (2000 - Math.floor((month = Math.floor((month + 9) % 12)) / 10))) * 365 + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + Math.floor((month * 306 + 5) / 10) + now.getUTCDate() - 1 - 738570;

    return Math.floor(days / 7) + ((Math.floor(days % 7) === 0 && now.getUTCHours() < 12) ? 0 : 1);
};

const merkleRoot = async function (spectrumIndex, digest, siblings) {
    const { K12 } = await crypto;
    const pair = new Uint8Array(crypto.DIGEST_LENGTH * 2);
    const root = new Uint8Array(crypto.DIGEST_LENGTH);

    root.set(digest.slice());

    for (let i = 0; i < SPECTRUM_DEPTH; i++) {
        if ((spectrumIndex & 1) == 0) {
            pair.set(root);
            pair.set(siblings.slice(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH), crypto.DIGEST_LENGTH);
        } else {
            pair.set(siblings.slice(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH));
            pair.set(root, crypto.DIGEST_LENGTH);
        }
        K12(pair, root, crypto.DIGEST_LENGTH);

        spectrumIndex >>= 1;
    }

    return root;
}

export const createClient = function (numberOfStoredTicks = MAX_NUMBER_OF_TICKS_PER_EPOCH) {

    return function () {
        const that = this;
        const epochs = new Map();
        const uniquePeersByEpoch = new Map();
        const ticks = new Map();
        const quorumTicks = new Map();
        
        const voteFlagsByTick = new Map();

        const entities = new Map();
        const entitiesByTick = new Map();

        const system = {
            epoch: 0,
            tick: 0,
            initialTick: 0,
        };

        const startupTime = Date.now();

        const tickHints = new Set();

        let quorumTickRequestingInterval;
        let currentTickInfoRequestingInterval;
        let averageQuorumTickProcessingDuration = TARGET_TICK_DURATION;

        let numberOfUpdatedEntities = 0;
        let numberOfClearedTransactions = 0;

        let latestQuorumTickTimestamp;

        const requestComputors = function (peer) {
            const message = createMessage(REQUEST_COMPUTORS.TYPE);
            message.randomizeDezavu();
            peer.transmit(message);
        };

        const requestCurrentTickInfo = function (peer) {
            peer.transmitToAll(function () {
                const message = createMessage(REQUEST_CURRENT_TICK_INFO.TYPE);
                message.randomizeDezavu();
                return message;
            });
        };

        const requestQuorumTick = function (peer, tickHint) {
            let tickVoteFlags = voteFlagsByTick.get(tickHint);
            if (tickVoteFlags === undefined) {
                tickVoteFlags = new Uint8Array(REQUEST_QUORUM_TICK.VOTE_FLAGS_LENGTH);
                voteFlagsByTick.set(tickHint, tickVoteFlags);
            }

            peer.transmitToAll(function (peerIndex, numberOfPeers) {
                const message = createMessage(REQUEST_QUORUM_TICK.TYPE);
                message.randomizeDezavu();
                message.setUint32(REQUEST_QUORUM_TICK.TICK_OFFSET, tickHint);

                const voteFlags = tickVoteFlags.slice();
                for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                    if (i < (peerIndex * Math.floor(NUMBER_OF_COMPUTORS / numberOfPeers)) && i > ((peerIndex + 1) * Math.floor(NUMBER_OF_COMPUTORS / numberOfPeers))) {
                        voteFlags[i >> 3] |= (1 << (i & 7));
                    }
                }

                message.set(voteFlags, REQUEST_QUORUM_TICK.VOTE_FLAGS_OFFSET);
                return message;
            });
        };

        const requestEntity = function (peer, entity) {
            const message = createMessage(REQUEST_ENTITY.TYPE);
            message.set(entity.publicKey, REQUEST_ENTITY.PUBLIC_KEY_OFFSET);
            message.randomizeDezavu();
            peer.transmit(message);
        };

        const verify = async function (tick, peer) {
            let quorumTick = quorumTicks.get(tick);

            if (quorumTick === undefined) {
                const storedTicks = ticks.get(tick) || [];
                const nextStoredTicks = ticks.get(tick + 1) || [];

                if (storedTicks.filter(tick => tick !== undefined).length >= QUORUM && nextStoredTicks.findIndex(tick => tick !== undefined) > -1) {
                    const { K12 } = await crypto;
                    const saltedDigest = new Uint8Array(crypto.DIGEST_LENGTH);
                    const saltedData = new Uint8Array(crypto.PUBLIC_KEY_LENGTH + crypto.DIGEST_LENGTH);

                    for (let k = 0; k < NUMBER_OF_COMPUTORS; k++) {
                        if (nextStoredTicks[k] !== undefined) {
                            for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                                if (storedTicks[i] !== undefined) {
                                    saltedData.set(storedTicks[i].computorPublicKey);
                                    saltedData.set(nextStoredTicks[k].prevResourceTestingDigest, crypto.PUBLIC_KEY_LENGTH);
                                    K12(saltedData.subarray(0, crypto.PUBLIC_KEY_LENGTH + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH), saltedDigest, BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH);

                                    if (equal(saltedDigest.subarray(0, BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH), storedTicks[i].saltedResourceTestingDigest)) {
                                        saltedData.set(nextStoredTicks[k].prevSpectrumDigest, crypto.PUBLIC_KEY_LENGTH);
                                        K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                        if (equal(saltedDigest, storedTicks[i].saltedSpectrumDigest)) {
                                            saltedData.set(nextStoredTicks[k].prevUniverseDigest, crypto.PUBLIC_KEY_LENGTH);
                                            K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                            if (equal(saltedDigest, storedTicks[i].saltedUniverseDigest)) {
                                                saltedData.set(nextStoredTicks[k].prevComputerDigest, crypto.PUBLIC_KEY_LENGTH);
                                                K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);
    
                                                if (equal(saltedDigest, storedTicks[i].saltedComputerDigest)) {
                                                    const quorumComputorIndices = [storedTicks[i].computorIndex];

                                                    for (let j = 0; j < NUMBER_OF_COMPUTORS; j++) {
                                                        if (j !== i && storedTicks[j] !== undefined) {

                                                            if (
                                                                equal(storedTicks[i].time, storedTicks[j].time) &&
                                                                equal(storedTicks[i].prevSpectrumDigest, storedTicks[j].prevSpectrumDigest) &&
                                                                equal(storedTicks[i].prevUniverseDigest, storedTicks[j].prevUniverseDigest) &&
                                                                equal(storedTicks[i].prevComputerDigest, storedTicks[j].prevComputerDigest) &&
                                                                equal(storedTicks[i].transactionDigest, storedTicks[j].transactionDigest)
                                                            ) {
                                                                saltedData.set(storedTicks[j].computorPublicKey);
                                                                saltedData.set(nextStoredTicks[k].prevResourceTestingDigest, crypto.PUBLIC_KEY_LENGTH);
                                                                K12(saltedData.subarray(0, crypto.PUBLIC_KEY_LENGTH + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH), saltedDigest, BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH);
                                
                                                                if (equal(saltedDigest.subarray(0, BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH), storedTicks[j].saltedResourceTestingDigest)) {
                                                                    saltedData.set(nextStoredTicks[k].prevSpectrumDigest, crypto.PUBLIC_KEY_LENGTH);
                                                                    K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                                                    if (equal(saltedDigest, storedTicks[j].saltedSpectrumDigest)) {
                                                                        saltedData.set(nextStoredTicks[k].prevUniverseDigest, crypto.PUBLIC_KEY_LENGTH);
                                                                        K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                                                        if (equal(saltedDigest, storedTicks[j].saltedUniverseDigest)) {
                                                                            saltedData.set(nextStoredTicks[k].prevComputerDigest, crypto.PUBLIC_KEY_LENGTH);
                                                                            K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                                                            if (equal(saltedDigest, storedTicks[j].saltedComputerDigest)) {
                                                                                quorumComputorIndices.push(storedTicks[j].computorIndex);

                                                                                if (quorumComputorIndices.length === QUORUM) {
                                                                                    quorumTick = Object.freeze({
                                                                                        computorIndices: Object.freeze(quorumComputorIndices),
                                                                                        tick: storedTicks[j].tick,
                                                                                        epoch: storedTicks[j].epoch,

                                                                                        timestamp: storedTicks[j].month.toString().padStart(2, '0') + '-' + storedTicks[j].day.toString().padStart(2, '0') + '-' + storedTicks[j].year.toString() +
                                                                                            'T' + storedTicks[j].hour.toString().padStart(2, '0') + ':' + storedTicks[j].minute.toString().padStart(2, '0') + ':' + storedTicks[j].second.toString().padStart(2, '0') + '.' + storedTicks[j].millisecond.toString().padStart(3, '0'),

                                                                                        prevResourceTestingDigest: bigUint64ToString(bytesToBigUint64(storedTicks[j].prevResourceTestingDigest)),
                                                                                        resourceTestingDigest:  bigUint64ToString(bytesToBigUint64(nextStoredTicks[k].prevResourceTestingDigest)),

                                                                                        prevSpectrumDigest: digestBytesToString(storedTicks[j].prevSpectrumDigest),
                                                                                        prevUniverseDigest: digestBytesToString(storedTicks[j].prevUniverseDigest),
                                                                                        prevComputerDigest: digestBytesToString(storedTicks[j].prevComputerDigest),
                                                                                        spectrumDigest: digestBytesToString(nextStoredTicks[k].prevSpectrumDigest),
                                                                                        universeDigest: digestBytesToString(nextStoredTicks[k].prevUniverseDigest),
                                                                                        computerDigest: digestBytesToString(nextStoredTicks[k].prevComputerDigest),

                                                                                        transactionDigest: digestBytesToString(storedTicks[j].transactionDigest),
                                                                                        expectedNextTickTransactionDigest: digestBytesToString(storedTicks[j].expectedNextTickTransactionDigest),
                                                                                    });

                                                                                    if (quorumTicks.size === numberOfStoredTicks) {
                                                                                        quorumTicks.delete(quorumTicks.keys().next().value);
                                                                                    }
                                                                                    quorumTicks.set(quorumTick.tick, quorumTick);

                                                                                    ticks.forEach(function (tick) {
                                                                                        if (tick.tick <= quorumTick.tick) {
                                                                                            ticks.delete(tick.tick);
                                                                                            voteFlags.delete(tick.tick);
                                                                                        }
                                                                                    });

                                                                                    tickHints.forEach(function (tickHint) {
                                                                                        if (tickHint <= quorumTick) {
                                                                                            tickHints.delete(tickHint);
                                                                                        }
                                                                                    });

                                                                                    break;
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    
                                                        if (quorumComputorIndices.length + (NUMBER_OF_COMPUTORS - j) < QUORUM) {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    if (quorumTick) {
                                        break;
                                    }
                                }

                                if (i > NUMBER_OF_COMPUTORS - QUORUM) {
                                    return;
                                }
                            }
                        }

                        if (quorumTick) {
                            break;
                        }
                    }
                }
            }

            if (quorumTick) {
                if (system.tick < quorumTick.tick) {
                    const now = Date.now();

                    if (system.tick > 0) {
                        const stats = Object.freeze({
                            tick: system.tick,
                            duration: now - (latestQuorumTickTimestamp || startupTime),
                            numberOfSkippedTicks: (quorumTick.tick - 1) - system.tick,
                            numberOfUpdatedEntities,
                            numberOfSkippedEntities: entities.size - numberOfUpdatedEntities,
                            numberOfClearedTransactions,
                        });

                        that.emit('tick_stats', stats);
                    }

                    latestQuorumTickTimestamp = now;
                    averageQuorumTickProcessingDuration = Math.ceil((latestQuorumTickTimestamp - startupTime) / (quorumTick.tick - (system.initialTick || quorumTick.tick - 1)));

                    system.tick = quorumTick.tick;

                    if (system.initialTick === 0) {
                        system.initialTick = system.tick;
                    }

                    that.emit('tick', quorumTick);

                    numberOfUpdatedEntities = 0;
                    numberOfClearedTransactions = 0;

                    if (currentTickInfoRequestingInterval === undefined) {
                        requestCurrentTickInfo(peer);
                        currentTickInfoRequestingInterval = setInterval(() => requestCurrentTickInfo(peer), TARGET_TICK_DURATION);
                    }
                }

                if (entitiesByTick.has(quorumTick.tick)) {
                    for (const tickEntities of entitiesByTick.get(quorumTick.tick).values()) {
                        for (const respondedEntity of tickEntities) {
                            if (isZero(respondedEntity.spectrumDigest)) {
                                respondedEntity.spectrumDigest = await merkleRoot(respondedEntity.spectrumIndex, respondedEntity.digest, respondedEntity.siblings);
                            }

                            if (digestBytesToString(respondedEntity.spectrumDigest) === quorumTick.spectrumDigest) {
                                const entity = entities.get(respondedEntity.id);

                                if (entity !== undefined && ((entity.tick || 0) < (entity.tick = quorumTick.tick))) {
                                    entitiesByTick.get(quorumTick.tick).delete(respondedEntity.id);
                                    if (entitiesByTick.get(quorumTick.tick).size === 0) {
                                        entitiesByTick.delete(quorumTick.tick);
                                    }

                                    let outgoingTransaction;

                                    if (entity.outgoingTransaction !== undefined && entity.outgoingTransaction.tick <= quorumTick.tick) {
                                        outgoingTransaction = Object.freeze({
                                            sourceId: entity.outgoingTransaction.sourceId,
                                            destinationId: entity.outgoingTransaction.destinationId,
                                            amount: entity.outgoingTransaction.amount,
                                            tick: entity.outgoingTransaction.tick,
                                            inputType: entity.outgoingTransaction.inputType,
                                            input: entity.outgoingTransaction.input,
                                            digest: entity.outgoingTransaction.digest,
                                            signature: entity.outgoingTransaction.signature,
                                            ...((entity.outgoingTransaction.contractIPO_BidQuantity > 0) ? {
                                                contractIPO_BidPrice: entity.outgoingTransaction.contractIPO_BidPrice,
                                                contractIPO_BidQuantity: entity.outgoingTransaction.contractIPO_BidQuantity,
                                                contractIPO_BidAmount: entity.outgoingTransaction.contractIPO_BidAmount,
                                            } : {}),
                                            executedContractIndex: entity.outgoingTransaction.executedContractIndex,
                                            executed: ((entity.outgoingTransaction.destinationId !== entity.id && (entity.outgoingTransaction.amount > 0n || entity.outgoingTransaction.contractIPO_BidQuantity > 0)) &&
                                                respondedEntity.latestOutgoingTransferTick === entity.outgoingTransaction.tick),
                                        });

                                        entity.outgoingTransaction = undefined;

                                        if (IS_BROWSER) {
                                            localStorage.removeItem(entity.id);
                                        } else {
                                            const path = await importPath;
                                            const fs = await importFs;
        
                                            const file = path.join(process.cwd(), STORED_ENTITIES_DIR, entity.id);
        
                                            if (fs.existsSync(file)) {
                                                fs.unlinkSync(file);
                                            }
                                        }

                                        if (outgoingTransaction.destinationId !== entity.id && (outgoingTransaction.amount > 0n || outgoingTransaction.contractIPO_BidPrice > 0n)) {                                            
                                            that.emit('transfer', outgoingTransaction);
                                        }

                                        numberOfClearedTransactions++;
                                    }
        
                                    entity.incomingAmount = respondedEntity.incomingAmount;
                                    entity.outgoingAmount = respondedEntity.outgoingAmount;
                                    entity.energy = entity.incomingAmount - entity.outgoingAmount;
                                    entity.numberOfIncomingTransfers = respondedEntity.numberOfIncomingTransfers;
                                    entity.numberOfOutgoingTransfers = respondedEntity.numberOfOutgoingTransfers;
        
                                    entity.latestIncomingTransferTick = respondedEntity.latestIncomingTransferTick;
                                    entity.latestOutgoingTransferTick = respondedEntity.latestOutgoingTransferTick;
        
                                    entity.epoch = quorumTick.epoch;
                                    entity.timestamp = quorumTick.timestamp;
        
                                    entity.digest = digestBytesToString(respondedEntity.digest);
                                    entity.siblings = Object.freeze(Array(SPECTRUM_DEPTH).fill('').map((_, i) => digestBytesToString(respondedEntity.siblings.subarray(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH))));
                                    entity.spectrumIndex = respondedEntity.spectrumIndex;
                                    entity.spectrumDigest = digestBytesToString(respondedEntity.spectrumDigest);

                                    numberOfUpdatedEntities++;

                                    that.emit('entity', Object.freeze({
                                        id: entity.id,
                                        energy: entity.energy,
                                        incomingAmount: entity.incomingAmount,
                                        outgoingAmount: entity.outgoingAmount,
                                        numberOfIncomingTransfers: entity.numberOfIncomingTransfers,
                                        numberOfOutgoingTransfers: entity.numberOfOutgoingTransfers,
                                        latestIncomingTransferTick: entity.latestIncomingTransferTick,
                                        latestOutgoingTransferTick: entity.latestOutgoingTransferTick,
        
                                        tick: entity.tick = quorumTick.tick,
                                        epoch: entity.epoch,
                                        timestamp: entity.timestamp = quorumTick.timestamp,
        
                                        digest: entity.digest = digestBytesToString(respondedEntity.digest),
                                        siblings: entity.siblings,
                                        spectrumIndex: entity.spectrumIndex,
                                        spectrumDigest: entity.spectrumDigest,
        
                                        ...(outgoingTransaction ?  { outgoingTransaction } : {}),
                                    }));
        
                                    if ((entity.outgoingTransaction === undefined || entity.outgoingTransaction.tick <= system.tick) && entity.emitter) {
                                        entity.emitter.emit('execution_tick', system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + Math.ceil(averageQuorumTickProcessingDuration / TARGET_TICK_DURATION) + 1);
                                    }
                                }

                                break;
                            } else {
                                // anotherRespondedEntity.peer.ignore(); // fix later, entity could be invalid because of data race.
                            }

                            if (!entitiesByTick.get(quorumTick.tick).has(respondedEntity.id)) {
                                break;
                            }
                        }

                        if (!entitiesByTick.has(quorumTick.tick)) {
                            break;
                        }
                    }
                }
            }
        };

        const receiveCallback = async function (type, message, peer) {
            switch (type) {
                case EXCHANGE_PUBLIC_PEERS.TYPE:
                    requestComputors(peer);
                    break;

                case BROADCAST_COMPUTORS.TYPE:
                    if (message.byteLength === BROADCAST_COMPUTORS.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);

                        const receivedComputors = {
                            epoch: messageView.getUint16(BROADCAST_COMPUTORS.EPOCH_OFFSET, true),
                            computorPublicKeys: new Array(NUMBER_OF_COMPUTORS).fill(new Uint8Array(crypto.PUBLIC_KEY_LENGTH)),
                            computorPublicKeyStrings: new Array(NUMBER_OF_COMPUTORS).fill(NULL_ID_STRING),

                            digest: new Uint8Array(crypto.DIGEST_LENGTH),
                            signature: message.subarray(BROADCAST_COMPUTORS.SIGNATURE_OFFSET),

                            faultyComputorFlags: new Array(NUMBER_OF_COMPUTORS).fill(false),
                        };

                        const inferredEpoch = inferEpoch();

                        if (receivedComputors.epoch <= inferredEpoch) {
                            const { K12, schnorrq } = await crypto;

                            K12(message.subarray(BROADCAST_COMPUTORS.EPOCH_OFFSET, BROADCAST_COMPUTORS.SIGNATURE_OFFSET), receivedComputors.digest, crypto.DIGEST_LENGTH);

                            if (schnorrq.verify(await ARBITRATOR_BYTES, receivedComputors.digest, receivedComputors.signature)) {
                                if (system.epoch === 0) {
                                    const checkpointBytes = new Uint8Array(BROADCAST_COMPUTORS.EPOCH_LENGTH + BROADCAST_COMPUTORS.PUBLIC_KEYS_LENGTH);
                                    const checkpointBytesView = new DataView(checkpointBytes.buffer, checkpointBytes.byteOffset);
                                    const checkpoint = {
                                        epoch: CHECKPOINT.epoch,
                                        computorPublicKeys: checkpointBytes.slice(BROADCAST_COMPUTORS.EPOCH_LENGTH),
                                        computorPublicKeyStrings: CHECKPOINT.computorPublicKeys,

                                        digest: new Uint8Array(crypto.DIGEST_LENGTH),
                                        signature: stringToBytes64(CHECKPOINT.signature),

                                        faultyComputorFlags: new Array(NUMBER_OF_COMPUTORS).fill(false),
                                    };

                                    checkpointBytesView.setUint16(0, CHECKPOINT.epoch, true);
                                    for (let i = 0, offset = BROADCAST_COMPUTORS.EPOCH_LENGTH; i < NUMBER_OF_COMPUTORS; i++, offset += crypto.PUBLIC_KEY_LENGTH) {
                                        checkpointBytes.set(await idToBytes(CHECKPOINT.computorPublicKeys[i]), offset);
                                    }

                                    K12(checkpointBytes, checkpoint.digest, crypto.DIGEST_LENGTH);

                                    if (schnorrq.verify(await ARBITRATOR_BYTES, checkpoint.digest, checkpoint.signature)) {
                                        epochs.set((system.epoch = CHECKPOINT.epoch), checkpoint);
                                    } else {
                                        throw new Error('Invalid checkpoint signature!');
                                    }
                                }

                                if (epochs.has(receivedComputors.epoch)) {
                                    if (equal(epochs.get(receivedComputors.epoch).digest, receivedComputors.digest)) {
                                        uniquePeersByEpoch.get(receivedComputors.epoch).add(peer.address);

                                        for (let i = system.epoch + 1; i <= inferredEpoch; i++) {
                                            if (!epochs.has(i) || (uniquePeersByEpoch.get(i).size < (Math.floor((2 / 3) * MIN_NUMBER_OF_PUBLIC_PEERS) + 1))) {
                                                return;
                                            }
                                        }
                                        for (let i = system.epoch; i < inferredEpoch; i++) {
                                            let numberOfReplacedComputors = 0;
    
                                            for (let j = 0; j < NUMBER_OF_COMPUTORS; j++) {
                                                if (epochs.get(i + 1).computorPublicKeyStrings.indexOf(epochs.get(i).computorPublicKeyStrings[j]) === -1) {
                                                    if (++numberOfReplacedComputors > NUMBER_OF_COMPUTORS - QUORUM) {
                                                        throw new Error(`Illegal number of replaced computors! (epoch ${i + 1})`);
                                                    }
                                                }
                                            }
                                        }
    
                                        if (inferredEpoch > system.epoch) {
                                            const epoch = epochs.get(inferredEpoch);
    
                                            system.epoch = epoch.epoch;
    
                                            that.emit('epoch', {
                                                epoch: epoch.epoch,
                                                computorPublicKeys: epoch.computorPublicKeyStrings,
    
                                                digest: digestBytesToString(epoch.digest),
                                                signature: bytes64ToString(epoch.signature),
                                            });
                                        }


                                        if (quorumTickRequestingInterval === undefined && currentTickInfoRequestingInterval === undefined) {
                                            requestCurrentTickInfo(peer);
                                        }
                                    } else {
                                        system.epoch = 0x10000;
                                        that.emit('error', 'Select another arbitrator.');
                                    }
                                } else {
                                    for (let i = 0, offset = BROADCAST_COMPUTORS.PUBLIC_KEYS_OFFSET; i < NUMBER_OF_COMPUTORS; i++) {
                                        receivedComputors.computorPublicKeys[i] = message.slice(offset, (offset += crypto.PUBLIC_KEY_LENGTH));
                                        receivedComputors.computorPublicKeyStrings[i] = await bytesToId(receivedComputors.computorPublicKeys[i]);
                                    }
                                    epochs.set(receivedComputors.epoch, receivedComputors);

                                    const uniquePeers = new Set();
                                    uniquePeers.add(peer.address);
                                    uniquePeersByEpoch.set(receivedComputors.epoch, uniquePeers);
                                }
                            } else {
                                peer.ignore();
                            }
                        } else {
                            peer.ignore();
                        }
                    } else {
                        peer.ignore();
                    }
                    break;

                case BROADCAST_TICK.TYPE:
                    if (message.length === BROADCAST_TICK.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);
                        const computorIndex = messageView.getUint16(BROADCAST_TICK.COMPUTOR_INDEX_OFFSET, true);
                        const epoch = messageView.getUint16(BROADCAST_TICK.EPOCH_OFFSET, true);

                        const receivedTick = {
                            computorIndex,
                            computorPublicKey: epochs.get(epoch)?.computorPublicKeys[computorIndex] || new Uint8Array(crypto.PUBLIC_KEY_LENGTH),
                            epoch,
                            tick: messageView.getUint32(BROADCAST_TICK.TICK_OFFSET, true),

                            time: message.subarray(BROADCAST_TICK.TIME_OFFSET, BROADCAST_TICK.TIME_OFFSET + BROADCAST_TICK.TIME_LENGTH),
                            millisecond: messageView.getUint16(BROADCAST_TICK.MILLISECOND_OFFSET, true),
                            second: message[BROADCAST_TICK.SECOND_OFFSET],
                            minute: message[BROADCAST_TICK.MINUTE_OFFSET],
                            hour: message[BROADCAST_TICK.HOUR_OFFSET],
                            day: message[BROADCAST_TICK.DAY_OFFSET],
                            month: message[BROADCAST_TICK.MONTH_OFFSET],
                            year: message[BROADCAST_TICK.YEAR_OFFSET],

                            prevResourceTestingDigest: message.subarray(BROADCAST_TICK.PREV_RESOURCE_TESTING_DIGEST_OFFSET, BROADCAST_TICK.PREV_RESOURCE_TESTING_DIGEST_OFFSET + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH),
                            saltedResourceTestingDigest: message.subarray(BROADCAST_TICK.SALTED_RESOURCE_TESTING_DIGEST_OFFSET, BROADCAST_TICK.SALTED_RESOURCE_TESTING_DIGEST_OFFSET + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH),

                            prevSpectrumDigest: message.subarray(BROADCAST_TICK.PREV_SPECTRUM_DIGEST_OFFSET, BROADCAST_TICK.PREV_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            prevUniverseDigest: message.subarray(BROADCAST_TICK.PREV_UNIVERSE_DIGEST_OFFSET, BROADCAST_TICK.PREV_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            prevComputerDigest: message.subarray(BROADCAST_TICK.PREV_COMPUTER_DIGEST_OFFSET, BROADCAST_TICK.PREV_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            saltedSpectrumDigest: message.subarray(BROADCAST_TICK.SALTED_SPECTRUM_DIGEST_OFFSET, BROADCAST_TICK.SALTED_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            saltedUniverseDigest: message.subarray(BROADCAST_TICK.SALTED_UNIVERSE_DIGEST_OFFSET, BROADCAST_TICK.SALTED_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            saltedComputerDigest: message.subarray(BROADCAST_TICK.SALTED_COMPUTER_DIGEST_OFFSET, BROADCAST_TICK.SALTED_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH),

                            transactionDigest: message.subarray(BROADCAST_TICK.TRANSACTION_DIGEST_OFFSET, BROADCAST_TICK.TRANSACTION_DIGEST_OFFSET + crypto.DIGEST_LENGTH),
                            expectedNextTickTransactionDigest: message.subarray(BROADCAST_TICK.EXPECTED_NEXT_TICK_TRANSACTION_DIGEST_OFFSET, BROADCAST_TICK.EXPECTED_NEXT_TICK_TRANSACTION_DIGEST_OFFSET + crypto.DIGEST_LENGTH),

                            digest: new Uint8Array(crypto.DIGEST_LENGTH),
                            signature: message.subarray(BROADCAST_TICK.SIGNATURE_OFFSET, BROADCAST_TICK.SIGNATURE_OFFSET + crypto.SIGNATURE_LENGTH),
                        };

                        if (receivedTick.epoch === inferEpoch() && receivedTick.epoch === system.epoch && receivedTick.tick > system.tick) {
                            if (!epochs.get(epoch).faultyComputorFlags[computorIndex]) {
                                if (
                                    receivedTick.computorIndex < NUMBER_OF_COMPUTORS &&
                                    !isZero(receivedTick.computorPublicKey) &&

                                    receivedTick.month > 0 &&
                                    receivedTick.month <= 12 &&
                                    receivedTick.day > 0 &&
                                    receivedTick.day <= (
                                        (
                                            receivedTick.month == 1 ||
                                            receivedTick.month == 3 ||
                                            receivedTick.month == 5 ||
                                            receivedTick.month == 7 ||
                                            receivedTick.month == 8 ||
                                            receivedTick.month == 10 ||
                                            receivedTick.month == 12
                                        ) ? 31 : (
                                            (
                                                receivedTick.month == 4 ||
                                                receivedTick.month == 6 ||
                                                receivedTick.month == 9 ||
                                                receivedTick.month == 11
                                            ) ? 30 : (
                                                (receivedTick.year & 3) ? 28 : 29
                                            )
                                        )
                                    ) &&
                                    receivedTick.hour <= 23 &&
                                    receivedTick.minute <= 59 &&
                                    receivedTick.second <= 59 &&
                                    receivedTick.millisecond <= 999
                                ) {
                                    const { K12, schnorrq } = await crypto;
                            
                                    message[BROADCAST_TICK.COMPUTOR_INDEX_OFFSET] ^= BROADCAST_TICK.TYPE;
                                    K12(message.subarray(BROADCAST_TICK.COMPUTOR_INDEX_OFFSET, BROADCAST_TICK.SIGNATURE_OFFSET), receivedTick.digest, crypto.DIGEST_LENGTH);
                                    message[BROADCAST_TICK.COMPUTOR_INDEX_OFFSET] ^= BROADCAST_TICK.TYPE;

                                    if (schnorrq.verify(receivedTick.computorPublicKey, receivedTick.digest, receivedTick.signature)) {
                                        const storedTick = ticks.get(receivedTick.tick)?.[computorIndex];

                                        if (storedTick === undefined) {
                                            if (ticks.get(receivedTick.tick) === undefined) {
                                                ticks.set(receivedTick.tick, Array(NUMBER_OF_COMPUTORS).fill(undefined));
                                            }

                                            ticks.get(receivedTick.tick)[computorIndex] = receivedTick;

                                            if (ticks.get(receivedTick.tick).filter(t => t !== undefined).length > 0 && (ticks.get(receivedTick.tick - 1)?.filter(t => t !== undefined) || []).length >= QUORUM) {
                                                if (entitiesByTick.has(receivedTick.tick - 1) || entities.size === 0) {
                                                    verify(receivedTick.tick - 1, peer);
                                                }
                                            }
                                        } else if (
                                            !equal(receivedTick.time, storedTick.time) &&
                                            !equal(receivedTick.prevSpectrumDigest, storedTick.prevSpectrumDigest) &&
                                            !equal(receivedTick.prevUniverseDigest, storedTick.prevUniverseDigest) &&
                                            !equal(receivedTick.prevComputerDigest, storedTick.prevComputerDigest) &&
                                            !equal(receivedTick.transactionDigest, storedTick.transactionDigest) &&
                                            !equal(receivedTick.expectedNextTickTransactionDigest, storedTick.expectedNextTickTransactionDigest)
                                        ) {
                                            epochs.get(epoch).faultyComputorFlags[computorIndex] = true;
                                            peer.ignore();
                                        }
                                    } else {
                                        peer.ignore();
                                    }
                                } else {
                                    peer.ignore();
                                }
                            }
                        }
                    } else {
                        peer.ignore();
                    }
                    break;

                case RESPOND_CURRENT_TICK_INFO.TYPE:
                    if (message.length === RESPOND_CURRENT_TICK_INFO.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);
                        const tickHint = messageView.getUint32(RESPOND_CURRENT_TICK_INFO.TICK_OFFSET, true);

                        if (tickHint > system.tick) {
                            entities.forEach(function (entity) {
                                requestEntity(peer, entity);
                            });

                            clearInterval(currentTickInfoRequestingInterval);
                            currentTickInfoRequestingInterval = undefined;
                            if (!tickHints.has(tickHint)) {
                                tickHints.add(tickHint);

                                requestQuorumTick(peer, tickHint);
                                requestQuorumTick(peer, tickHint + 1);

                                clearInterval(quorumTickRequestingInterval);
                                quorumTickRequestingInterval = setInterval(() => {
                                    let tick = tickHint > system.tick ? tickHint : system.tick + 1;
                                    if ((ticks.get(tick) || []).filter(t => t !== undefined).length < QUORUM) {
                                        requestQuorumTick(peer, tick);
                                    }
                                    if ((ticks.get(tick + 1) || []).filter(t => t !== undefined).length < QUORUM) {
                                        requestQuorumTick(peer, tick + 1);
                                    }

                                    if ((ticks.get(tick) || []).filter(t => t !== undefined).length >= QUORUM) {
                                        tick += 2;
                                        if ((ticks.get(tick) || []).filter(t => t !== undefined).length < QUORUM) {
                                            requestQuorumTick(peer, tick);
                                        }
                                        if ((ticks.get(tick + 1) || []).filter(t => t !== undefined).length < QUORUM) {
                                            requestQuorumTick(peer, tick + 1);
                                        }
                                    }
                                }, TARGET_TICK_DURATION);
                            }
                        } else {
                            if (currentTickInfoRequestingInterval === undefined) {
                                currentTickInfoRequestingInterval = setInterval(() => requestCurrentTickInfo(peer), TARGET_TICK_DURATION);
                            }
                        }
                    }
                    break;
                
                case RESPOND_ENTITY.TYPE:
                    if (message.length === RESPOND_ENTITY.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);
                        const respondedEntity = {
                            id: await bytesToId(message.subarray(RESPOND_ENTITY.PUBLIC_KEY_OFFSET, RESPOND_ENTITY.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
                            incomingAmount: messageView.getBigUint64(RESPOND_ENTITY.INCOMING_AMOUNT_OFFSET, true),
                            outgoingAmount: messageView.getBigUint64(RESPOND_ENTITY.OUTGOING_AMOUNT_OFFSET, true),
                            numberOfIncomingTransfers: messageView.getUint32(RESPOND_ENTITY.NUMBER_OF_INCOMING_TRANSFERS_OFFSET, true),
                            numberOfOutgoingTransfers: messageView.getUint32(RESPOND_ENTITY.NUMBER_OF_OUTGOING_TRANSFERS_OFFSET, true),
                            latestIncomingTransferTick: messageView.getUint32(RESPOND_ENTITY.LATEST_INCOMING_TRANSFER_TICK_OFFSET, true),
                            latestOutgoingTransferTick: messageView.getUint32(RESPOND_ENTITY.LATEST_OUTGOING_TRANSFER_TICK_OFFSET, true),
                            digest: new Uint8Array(crypto.DIGEST_LENGTH),
                            tick: messageView.getUint32(RESPOND_ENTITY.TICK_OFFSET, true),
                            spectrumIndex: messageView.getUint32(RESPOND_ENTITY.SPECTRUM_INDEX_OFFSET, true),
                            siblings: message.subarray(RESPOND_ENTITY.SIBLINGS_OFFSET, RESPOND_ENTITY.SIBLINGS_OFFSET + RESPOND_ENTITY.SIBLINGS_LENGTH),
                            spectrumDigest: new Uint8Array(crypto.DIGEST_LENGTH),
                            peer,
                        };

                        (await crypto).K12(message.slice(RESPOND_ENTITY.PUBLIC_KEY_OFFSET, RESPOND_ENTITY.LATEST_OUTGOING_TRANSFER_TICK_OFFSET + BROADCAST_TICK.TICK_LENGTH), respondedEntity.digest, crypto.DIGEST_LENGTH);

                        if (entities.has(respondedEntity.id)) {
                            if (respondedEntity.spectrumIndex > -1) {
                                let tickEntities = entitiesByTick.get(respondedEntity.tick);
                                if (tickEntities === undefined) {
                                    tickEntities = new Map();
                                    tickEntities.set(respondedEntity.id, []);
                                    entitiesByTick.set(respondedEntity.tick, tickEntities);
                                } else if (!tickEntities.has(respondedEntity.id)) {
                                    tickEntities.set(respondedEntity.id, []);
                                }
                                tickEntities.get(respondedEntity.id).push(respondedEntity);
                                if (ticks.has(respondedEntity.tick) && ticks.get(respondedEntity.tick).filter(t => t !== undefined).length >= QUORUM) {
                                   verify(respondedEntity.tick, peer);
                                }
                                
                            }
                        }
                    } else {
                        peer.ignore();
                    }
                    break;
            }
        };

        const transceiver = createTransceiver(receiveCallback);

        const _broadcastTransaction = function (transactionBytes) {
            const message = createMessage(BROADCAST_TRANSACTION.TYPE, transactionBytes.length);
            message.set(transactionBytes, 0);

            for (let i = 0; i <= TICK_TRANSACTIONS_PUBLICATION_OFFSET; i++) {
                setTimeout(() => transceiver.transmit(message), i * TARGET_TICK_DURATION);
            }
        }

        return Object.assign(
            this,
            {
                connect(options) {
                    transceiver.connect(options);
                },

                disconnect() {
                    transceiver.disconnect();
                },

                replace() {
                    transceiver.replace();
                },

                reset(options) {
                    transceiver.reset(options);
                },

                async subscribe({ id }) {
                    if (id !== undefined) {
                        if (!entities.has(id)) {
                            entities.set(id, {
                                id,
                                publicKey: await idToBytes(id),
                            });
                        }
                    }
                },

                unsubscribe({ id }) {
                    if (id !== undefined) {
                        if (entities.has(id) && !entities.get(id).emitter) {
                            entities.delete(id);
                        }
                    }
                },

                async createEntity(privateKey) {

                    return async function () {
                        const those = this;

                        const id = await createId(privateKey);
                        const publicKey = (await crypto).schnorrq.generatePublicKey(privateKey);

                        let entity = entities.get(id);
                        if (entity === undefined) {
                            entities.set(id, (entity = {
                                id,
                                publicKey,
                                outgoingTransaction: undefined,
                                emitter: those,
                            }));
                        } else {
                            if (entity.emitter !== undefined) {
                                throw new Error('Cannot duplicate entity.');
                            }

                            entity.outgoingTransaction = undefined;
                            entity.emitter = those;
                        }

                        let storedTransactionBytes;

                        if (IS_BROWSER) {
                            storedTransactionBytes = shiftedHexToBytes(localStorage.getItem(id));
                        } else {
                            const path = await importPath;
                            const fs = await importFs;

                            const dir = path.join(process.cwd(), STORED_ENTITIES_DIR);
                            const file = path.join(dir, id);
                            const temp = file + '-temp';

                            if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir);
                            } else {
                                if (fs.existsSync(temp)) {
                                    fs.renameSync(temp, file);
                                }
                            
                                if (fs.existsSync(file)) {
                                    const buffer = fs.readFileSync(file);
                                    storedTransactionBytes = Uint8Array.from(buffer);
                                }
                            }
                        }

                        if (storedTransactionBytes !== undefined) {
                            // TODO: decrypt
                            const storedTransaction = await inspectTransaction(storedTransactionBytes);
                        
                            if (storedTransaction.sourceId !== id) {
                                throw new Error('Invalid stored transaction!');
                            }

                            entity.outgoingTransaction = storedTransaction;
                        }

                        return Object.assign(
                            those,
                            {
                                get id() {
                                    return id;
                                },

                                async createTransaction(sourcePrivateKey, {
                                    destinationId,
                                    amount,
                                    tick,
                                    inputType,
                                    input,
                                    contractIPO_BidPrice,
                                    contractIPO_BidQuantity,
                                }) {
                                    if (system.tick === 0) {
                                        throw new Error('Failed to issue transaction, system not synchronized yet...');
                                    }

                                    if (entity.energy === undefined) {
                                        throw new Error('Failed to issue transaction, entity not synchronized yet...');
                                    }

                                    if (entity.outgoingTransaction !== undefined) {
                                        throw new Error(`There is pending outgoing transaction. (tick: ${entity.outgoingTransaction.tick})`);
                                    }

                                    if (typeof amount === 'bigint' && amount >= 0n && amount <= MAX_AMOUNT) {
                                        if (amount > entity.energy) {
                                            throw new Error('Amount exceeds possesed energy!');
                                        }
                                    } else {
                                        throw new TypeError('Invalid amount!');
                                    }

                                    if (contractIPO_BidPrice !== undefined || contractIPO_BidQuantity !== undefined) {
                                        if (
                                            typeof contractIPO_BidPrice === 'bigint' && contractIPO_BidPrice > 0n && contractIPO_BidPrice <= TRANSACTION.MAX_CONTRACT_IPO_BID_PRICE &&
                                            Number.isInteger(contractIPO_BidQuantity) && contractIPO_BidQuantity > 0 && contractIPO_BidQuantity <= TRANSACTION.MAX_CONTRACT_IPO_BID_QUANTITY
                                        ) {
                                            if (contractIPO_BidPrice * BigInt(contractIPO_BidQuantity) > entity.energy - amount) {
                                                throw new Error('Contract IPO bid exceeds possessed energy!');
                                            }
                                        } else {
                                            throw new TypeError('Invalid contract IPO bid.');
                                        }
                                    }

                                    const saneTick = system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + Math.ceil(averageQuorumTickProcessingDuration / TARGET_TICK_DURATION) + 1;

                                    if (tick !== undefined) {
                                        if (!Number.isInteger(tick)) {
                                            throw new TypeError('Invalid transaction tick!');
                                        }
                                        if (tick < saneTick) {
                                            throw new RangeError('Transaction tick not far enough in the future...');
                                        }
                                        if (tick - system.tick > Math.floor((60 * 1000) / TARGET_TICK_DURATION)) { // avoid timelocks as a result of setting tick too far in the future.
                                            throw new RangeError('Transaction tick too far in the future!');
                                        }
                                    } else {
                                        tick = saneTick;
                                    }
                
                                    const transaction = await createTransaction(sourcePrivateKey, {
                                        sourcePublicKey: publicKey,
                                        destinationId,
                                        amount,
                                        tick,
                                        inputType,
                                        input,
                                        contractIPO_BidPrice,
                                        contractIPO_BidQuantity,
                                    });

                                    if (IS_BROWSER) {
                                        // TODO: encrypt
                                        localStorage.setItem(id, bytesToShiftedHex(transaction.bytes));
                                    } else {
                                        const path = await importPath;
                                        const fs = await importFs;

                                        const dir = path.join(process.cwd(), STORED_ENTITIES_DIR);
                                        const file = path.join(dir, id);
                                        const temp = file + '-temp';

                                        if (!fs.existsSync(dir)) {
                                            fs.mkdirSync(dir);
                                        }

                                        // TODO: encrypt
                                        fs.writeFileSync(temp, Uint8Array.from(transaction.bytes));
                                        fs.renameSync(temp, file);
                                    }
                
                                    return (entity.outgoingTransaction = transaction);
                                },
                                broadcastTransaction() {
                                    if (entity.outgoingTransaction && entity.outgoingTransaction.tick > system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET) {
                                        _broadcastTransaction(entity.outgoingTransaction.bytes);
                                    }
                                },
                            },
                            EventEmitter.prototype,
                        );
                    }.call({});
                },

                get tick() {
                    return quorumTicks.get(system.tick);
                },

                executionTick() {
                    if (system.tick > 0) {
                        return Promise.resolve(system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + Math.ceil(averageQuorumTickProcessingDuration / TARGET_TICK_DURATION) + 1);
                    }

                    return new Promise(function (resolve) {
                        that.once('tick', function (tick) {
                            resolve(tick.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + Math.ceil(averageQuorumTickProcessingDuration / TARGET_TICK_DURATION) + 1);
                        });
                    });
                },

                broadcastTransaction(transaction) {
                    if (transaction.tick >= system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + 1) {
                        _broadcastTransaction(transaction.bytes);
                    }
                },
            },
            EventEmitter.prototype,
        );
    }.call({});
};
