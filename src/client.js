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
    ARBITRATOR_BYTES,
    NUMBER_OF_COMPUTORS,
    QUORUM,
    SPECTRUM_DEPTH,
    MAX_NUMBER_OF_TICKS_PER_EPOCH,
    TARGET_TICK_DURATION,
} from './constants.js'
import {
    REQUEST_RESPONSE_HEADER,
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
    NULL_BIG_UINT64_STRING,
    NULL_DIGEST_STRING,
    NULL_ID_STRING,
} from './converter.js';

export const isZero = function (array) {
    for (let i = 0; i < array.length; i++) {
      if (array[i] !== 0) {
        return false;
      }
    }
    return true;
}

export const equal = function (a, b) {
    if (a.length !== b.length) {
      return false;
    }
  
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
  
    return true;
}

export const inferEpoch = function() {
    const now = new Date();
    let year =  now.getUTCFullYear() - 2000;
    let month = now.getUTCMonth();
    const day = now.getUTCDate();
    const days = (Math.floor((year += (2000 - (month = (month + 9) % 12) / 10)) * 365 + year / 4 - year / 100 + year / 400 + (month * 306 + 5) / 10 + day - 1) - 738570);
    return Math.floor(days / 7) - (days % 7 === 0 && now.getUTCHours() < 12 ? 1 : 0);
};

const merkleRoot = async function (spectrumIndex, digest, siblings, root) {
    if (!isZero(root)) {
        return root;
    }

    const { K12 } = await crypto;
    const pair = new Uint8Array(crypto.DIGEST_LENGTH * 2);

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
        };

        let quorumTickRequestingInterval;

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
            message.set(entity.publicKeyBytes, REQUEST_ENTITY.PUBLIC_KEY_OFFSET);
            message.randomizeDezavu();
            peer.transmit(message);
        };

        const verify = async function (respondedEntity) {
            let quorumTick = quorumTicks.get(respondedEntity.tick);
            let isValid = false;

            if (quorumTick === undefined) {
                const storedTicks = ticks.get(respondedEntity.tick) || [];

                if (storedTicks.filter(tick => tick !== undefined).length >= QUORUM) {
                    const spectrumDigest = await merkleRoot(respondedEntity.spectrumIndex, respondedEntity.digest, respondedEntity.siblings, respondedEntity.spectrumDigest);

                    const { K12 } = await crypto;

                    for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                        if (storedTicks[i] !== undefined) {
                            const saltedDigest = new Uint8Array(crypto.DIGEST_LENGTH);
                            const saltedData = new Uint8Array(crypto.PUBLIC_KEY_LENGTH + crypto.DIGEST_LENGTH);

                            saltedData.set(storedTicks[i].computorPublicKey);
                            saltedData.set(spectrumDigest, crypto.PUBLIC_KEY_LENGTH);

                            K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                            if (equal(saltedDigest, storedTicks[i].saltedSpectrumDigest)) {
                                const quorumFlags = Array(NUMBER_OF_COMPUTORS).fill(false);
                                quorumFlags[i] = true;

                                let numberOfAlignedVotes = 1;

                                for (let j = 0; j < NUMBER_OF_COMPUTORS; j++) {
                                    if (j !== i && storedTicks[j] !== undefined) {
                                        if (equal(storedTicks[i].essenceDigest, storedTicks[j].essenceDigest)) {
                                            saltedData.set(storedTicks[j].computorPublicKey);
                                            K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);
            
                                            if (equal(saltedDigest, storedTicks[j].saltedSpectrumDigest)) {
                                                quorumFlags[j] = true;

                                                if (++numberOfAlignedVotes === QUORUM) {
                                                    quorumTick = {
                                                        computorIndices: storedTicks.reduce(function (acc, storedTick, k) {
                                                            if (quorumFlags[k]) {
                                                                acc.push(storedTick.computorIndex);
                                                            }
                                                            return acc;
                                                        }, []),
                                                        tick: storedTicks[j].tick,
                                                        epoch: storedTicks[j].epoch,
                                                        
                                                        timestamp: storedTicks[j].month.toString().padStart(2, '0') + '-' + storedTicks[j].day.toString().padStart(2, '0') + '-' + storedTicks[j].year.toString() +
                                                            'T' + storedTicks[j].hour.toString().padStart(2, '0') + ':' + storedTicks[j].minute.toString().padStart(2, '0') + ':' + storedTicks[j].second.toString().padStart(2, '0') + '.' + storedTicks[j].millisecond.toString().padStart(3, '0'),
                                                        
                                                        prevResourceTestingDigest: bigUint64ToString(bytesToBigUint64(storedTicks[j].prevResourceTestingDigest)),
                                                        resourceTestingDigest:  bigUint64ToString(bytesToBigUint64(NULL_BIG_UINT64_STRING)),

                                                        prevSpectrumDigest: digestBytesToString(storedTicks[j].prevSpectrumDigest),
                                                        prevUniverseDigest: digestBytesToString(storedTicks[j].prevUniverseDigest),
                                                        prevComputerDigest: digestBytesToString(storedTicks[j].prevComputerDigest),
                                                        spectrumDigest: digestBytesToString(spectrumDigest),
                                                        universeDigest: NULL_DIGEST_STRING,
                                                        computerDigest: NULL_DIGEST_STRING,

                                                        transactionDigest: digestBytesToString(storedTicks[j].transactionDigest),
                                                        expectedNextTickTransactionDigest: digestBytesToString(storedTicks[j].expectedNextTickTransactionDigest),
                                                    };

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

                                                    isValid = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    if (numberOfAlignedVotes + (NUMBER_OF_COMPUTORS - j) < QUORUM) {
                                        break;
                                    }
                                }
                            }

                            if (isValid) {
                                break;
                            }
                        }

                        if (i > NUMBER_OF_COMPUTORS - QUORUM) {
                            if (!isValid) { // entity data race artifact
                                if (quorumTickRequestingInterval !== undefined) {
                                    clearInterval(quorumTickRequestingInterval);
                                    quorumTickRequestingInterval = undefined;
                                    requestCurrentTickInfo(respondedEntity.peer);
                                }
                            }
                            break;
                        }
                    }
                }
            } else if (digestBytesToString(await merkleRoot(respondedEntity.spectrumIndex, respondedEntity.digest, respondedEntity.siblings, respondedEntity.spectrumDigest)) === quorumTick.spectrumDigest) {
                isValid = true;
            }

            if (isValid) {
                if (system.tick < quorumTick.tick) {
                    that.emit('tick', {
                        computorIndices: quorumTick.computorIndices.slice(),
                        epoch: quorumTick.epoch,
                        tick: quorumTick.tick,

                        timestamp: quorumTick.timestamp,

                        prevResourceTestingDigest: quorumTick.prevResourceTestingDigest,
                        resourceTestingDigest: quorumTick.resourceTestingDigest,

                        prevSpectrumDigest: quorumTick.prevSpectrumDigest,
                        prevUniverseDigest: quorumTick.prevUniverseDigest,
                        prevComputerDigest: quorumTick.prevComputerDigest,
                        spectrumDigest: quorumTick.spectrumDigest,
                        universeDigest: quorumTick.universeDigest,
                        computerDigest: quorumTick.computerDigest,

                        transactionDigest: quorumTick.transactionDigest,
                        expectedNextTickTransactionDigest: quorumTick.expectedNextTickTransactionDigest,
                    });

                    system.tick = quorumTick.tick;

                    if (quorumTickRequestingInterval !== undefined) {
                        clearInterval(quorumTickRequestingInterval);
                        quorumTickRequestingInterval = undefined;
                        requestCurrentTickInfo(respondedEntity.peer);
                    }
                }

                for (const tickEntitiesById of entitiesByTick.get(quorumTick.tick).values()) {
                    let validRespondedEntity;
                    for (const anotherRespondedEntity of tickEntitiesById) {
                        if (!digestBytesToString(await merkleRoot(anotherRespondedEntity.index, anotherRespondedEntity.digest, anotherRespondedEntity.siblings, anotherRespondedEntity.spectrumDigest)) === quorumTick.spectrumDigest) {
                            anotherRespondedEntity.peer.ignore();
                        } else {
                            validRespondedEntity = anotherRespondedEntity;
                        }
                    }

                    if (validRespondedEntity !== undefined) {
                        const entity = entities.get(validRespondedEntity.publicKey);

                        if (entity !== undefined && (entity.tick === undefined || entity.tick < quorumTick.tick)) {
                            entity.incomingAmount = validRespondedEntity.incomingAmount;
                            entity.outgoingAmount = validRespondedEntity.outgoingAmount;
                            entity.numberOfIncommingTransfers = validRespondedEntity.numberOfIncommingTransfers;
                            entity.numberOfOutgoingTransfers = validRespondedEntity.numberOfOutgoingTransfers;
                            entity.latestIncomingTransferTick = validRespondedEntity.latestIncomingTransferTick;
                            entity.latestOutgoingTransferTick = validRespondedEntity.latestOutgoingTransferTick;

                            entity.epoch = quorumTick.epoch;
                            entity.tick = quorumTick.tick;
                            entity.timestamp = quorumTick.timestamp;

                            entity.digest = digestBytesToString(validRespondedEntity.digest);
                            entity.siblings = Array(SPECTRUM_DEPTH);
                            for (let i = 0; i < SPECTRUM_DEPTH; i++) {
                                entity.siblings.push(digestBytesToString(validRespondedEntity.siblings.subarray(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH)));
                            }
                            entity.spectrumIndex = validRespondedEntity.spectrumIndex;
                            entity.spectrumDigest = digestBytesToString(validRespondedEntity.spectrumDigest);
                        
                            that.emit('entity', {
                                publicKey: entity.publicKey,
                                energy: entity.incomingAmount - entity.outgoingAmount,
                                incomingAmount: entity.incomingAmount,
                                outgoingAmount: entity.outgoingAmount,
                                numberOfIncommingTransfers: entity.numberOfIncommingTransfers,
                                numberOfOutgoingTransfers: entity.numberOfOutgoingTransfers,
                                latestIncomingTransferTick: entity.latestIncomingTransferTick,
                                latestOutgoingTransferTick: entity.latestOutgoingTransferTick,

                                epoch: entity.epoch,
                                tick: entity.tick,
                                timestamp: entity.timestamp,

                                digest: entity.digest,
                                siblings: entity.siblings,
                                spectrumIndex: entity.spectrumIndex,
                                spectrumDigest: entity.spectrumDigest,
                            });
                        }
                    }
                }

                entitiesByTick.forEach(function (tickEntitiesById) {
                    const tick = tickEntitiesById.entries().next().value.tick;
                    if (tick <= system.tick) {
                        entitiesByTick.delete(tick);
                    }
                });
            }
        };

        const receiveCallback = async function (message, peer) {
            switch (message[REQUEST_RESPONSE_HEADER.TYPE_OFFSET]) {
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
                                            if (!epochs.has(i) || uniquePeersByEpoch.get(i).size < Math.floor((2 / 3) * MIN_NUMBER_OF_PUBLIC_PEERS) + 1) {
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
    
                                            if (quorumTickRequestingInterval !== undefined) {
                                                clearInterval(quorumTickRequestingInterval);
                                                quorumTickRequestingInterval = undefined;
                                            }
                                        }


                                        if (quorumTickRequestingInterval === undefined) {
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

                            millisecond: messageView.getUint16(BROADCAST_TICK.MILLISECOND_OFFSET, true),
                            second: message[BROADCAST_TICK.SECOND_OFFSET],
                            minute: message[BROADCAST_TICK.MINUTE_OFFSET],
                            hour: message[BROADCAST_TICK.HOUR_OFFSET],
                            day: message[BROADCAST_TICK.DAY_OFFSET],
                            month: message[BROADCAST_TICK.MONTH_OFFSET],
                            year: message[BROADCAST_TICK.YEAR_OFFSET],

                            prevResourceTestingDigest: message.subarray(BROADCAST_TICK.PREV_RESOURCE_TESTING_DIGEST_OFFSET, BROADCAST_TICK.PREV_RESOURCE_TESTING_DIGEST_OFFSET + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH),
                            saltedResourceTestingDigest: message.subarray(BROADCAST_TICK.SALTED_RESOURCE_TESTING_DIGEST_OFFSET, BROADCAST_TICK.PREV_RESOURCE_TESTING_DIGEST_OFFSET + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH),

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

                            essenceDigest: new Uint8Array(crypto.DIGEST_LENGTH),
                        };

                        if (receivedTick.epoch === inferEpoch() && receivedTick.epoch === system.epoch && receivedTick.tick > system.tick) {
                            if (!epochs.get(epoch).faultyComputorFlags[computorIndex]) {
                                if (
                                    receivedTick.computorIndex < NUMBER_OF_COMPUTORS &&
                                    !isZero(receivedTick.computorPublicKey) &&

                                    receivedTick.month > 0 &&
                                    receivedTick.month <= 12 &&
                                    receivedTick.day > 0 &&
                                    receivedTick.day <= ((
                                    receivedTick.month == 1 ||
                                    receivedTick.month == 3 ||
                                    receivedTick.month == 5 ||
                                    receivedTick.month == 7 ||
                                    receivedTick.month == 8 ||
                                    receivedTick.month == 10 ||
                                    receivedTick.month == 12
                                    ) ? 31
                                    : ((
                                        receivedTick.month == 4 ||
                                        receivedTick.month == 6 ||
                                        receivedTick.month == 9 ||
                                        receivedTick.month == 11
                                    ) ? 30
                                        : ((receivedTick.year & 3)
                                        ? 28
                                        : 29))) &&
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
                                        let offset = 0;
                                        const essence = new Uint8Array(BROADCAST_TICK.MILLISECOND_LENGTH + 5 + crypto.DIGEST_LENGTH + 4 * crypto.DIGEST_LENGTH);
                                        new DataView(essence.buffer, essence.byteOffset).setUint16(offset, receivedTick.millisecond, true);
                                        essence[(offset += BROADCAST_TICK.MILLISECOND_LENGTH)] = receivedTick.second;
                                        essence[++offset] = receivedTick.minute;
                                        essence[++offset] = receivedTick.hour;
                                        essence[++offset] = receivedTick.day;
                                        essence[++offset] = receivedTick.month;
                                        essence[++offset] = receivedTick.year;
                                        essence.set(receivedTick.prevSpectrumDigest, ++offset);
                                        essence.set(receivedTick.prevUniverseDigest, (offset += crypto.DIGEST_LENGTH));
                                        essence.set(receivedTick.prevComputerDigest, (offset += crypto.DIGEST_LENGTH));
                                        essence.set(receivedTick.transactionDigest, offset + crypto.DIGEST_LENGTH);
                                        K12(essence, receivedTick.essenceDigest, crypto.DIGEST_LENGTH);

                                        const storedTick = ticks.get(receivedTick.tick)?.[computorIndex];

                                        if (storedTick === undefined) {
                                            if (ticks.get(receivedTick.tick) === undefined) {
                                                ticks.set(receivedTick.tick, Array(NUMBER_OF_COMPUTORS).fill(undefined));
                                            }
                                            ticks.get(receivedTick.tick)[computorIndex] = receivedTick;

                                            const tickEntities = entitiesByTick.get(receivedTick.tick);
                                            if (tickEntities !== undefined) {
                                                tickEntities.forEach(function (tickEntitiesById) {
                                                    tickEntitiesById.forEach(entity => verify(entity));
                                                });
                                            }
                                        } else {
                                            if (equal(receivedTick.essenceDigest, storedTick.essenceDigest)) {
                                                if (isZero(ticks.get(receivedTick.tick)[computorIndex].expectedNextTickTransactionDigest)) {
                                                    ticks.get(receivedTick.tick)[computorIndex] = receivedTick;
                                                } else if (!equal(ticks.get(receivedTick.tick)[computorIndex].expectedNextTickTransactionDigest, receivedTick.expectedNextTickTransactionDigest)) {
                                                    epochs.get(epoch).faultyComputorFlags[computorIndex] = true;
                                                    peer.ignore();
                                                }
                                            } else {
                                                epochs.get(epoch).faultyComputorFlags[computorIndex] = true;
                                                peer.ignore();
                                            }
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
                    if (quorumTickRequestingInterval === undefined) {
                        if (message.length === RESPOND_CURRENT_TICK_INFO.LENGTH) {
                            const messageView = new DataView(message.buffer, message.byteOffset);
                            const tickHint = messageView.getUint32(RESPOND_CURRENT_TICK_INFO.TICK_OFFSET, true);

                            if (tickHint > system.tick) {
                                requestQuorumTick(peer, tickHint);
                                quorumTickRequestingInterval = setInterval(() => {
                                    if (tickHint > system.tick) {
                                        requestQuorumTick(peer, tickHint);
                                    } else {
                                        clearInterval(quorumTickRequestingInterval);
                                        quorumTickRequestingInterval = undefined;
                                    }
                                }, TARGET_TICK_DURATION / 10);

                                entities.forEach(function (entity) {
                                    requestEntity(peer, entity);
                                });
                            }
                        }
                    }
                    break;
                
                case RESPOND_ENTITY.TYPE:
                    if (message.length === RESPOND_ENTITY.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);
                        const respondedEntity = {
                            publicKey: await bytesToId(message.subarray(RESPOND_ENTITY.PUBLIC_KEY_OFFSET, RESPOND_ENTITY.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
                            incomingAmount: messageView.getBigUint64(RESPOND_ENTITY.INCOMING_AMOUNT_OFFSET, true),
                            outgoingAmount: messageView.getBigUint64(RESPOND_ENTITY.OUTGOING_AMOUNT_OFFSET, true),
                            numberOfIncommingTransfers: messageView.getUint32(RESPOND_ENTITY.NUMBER_OF_INCOMING_TRANSFERS_OFFSET, true),
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

                        if (entities.has(respondedEntity.publicKey)) {
                            if (respondedEntity.spectrumIndex > -1) {
                                let tickEntities = entitiesByTick.get(respondedEntity.tick);
                                if (tickEntities === undefined) {
                                    tickEntities = new Map();
                                    tickEntities.set(respondedEntity.publicKey, []);
                                    entitiesByTick.set(respondedEntity.tick, tickEntities);
                                } else if (!tickEntities.has(respondedEntity.publicKey)) {
                                    entitiesByTick.set(respondedEntity.publicKey, []);
                                }
                                tickEntities.get(respondedEntity.publicKey).push(respondedEntity);

                                verify(respondedEntity);
                            }
                        } else {
                            peer.ignore();
                        }
                    } else {
                        peer.ignore();
                    }
                    break;
            }
        };

        const transceiver = createTransceiver(receiveCallback);

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
                        entities.set(id, {
                            publicKey: id,
                            publicKeyBytes: await idToBytes(id),
                        });
                    }
                },
                unsubscribe({ id }) {
                    if (id !== undefined) {
                        entities.delete(id);
                    }
                },
                broadcastTransaction(transaction) {
                    const message = createMessage(BROADCAST_TRANSACTION.TYPE, transaction.byteLength);
                    message.set(transaction, message.length - transaction.byteLength);
                    transceiver.transmit(message);
                },
                get tick() {
                    return quorumTicks.get(system.tick);
                },
                get tickOffset() {
                    // TODO
                },
            },
            EventEmitter.prototype,
        );
    }.call({});
};
