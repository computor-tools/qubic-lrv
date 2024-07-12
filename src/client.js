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
import crypto from 'qubic-crypto';
import { CHECKPOINT } from './checkpoint.js';
import {
    ARBITRATOR,
    ARBITRATOR_BYTES,
    NUMBER_OF_COMPUTORS,
    QUORUM,
    SPECTRUM_DEPTH,
    ASSETS_DEPTH,
    ASSET_TYPES,
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
    REQUEST_OWNED_ASSETS,
    RESPOND_OWNED_ASSETS,
    REQUEST_ISSUED_ASSETS,
    RESPOND_ISSUED_ASSETS,
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
    bytesToString,
} from './converter.js';
import { isZero, equal, createLock, IS_BROWSER } from './utils.js';
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

        const assetsByTick = new Map();
        const issuersByTick = new Map();

        const tickLock = createLock();

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

        let numberOfSkippedTicks;

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

        const requestOwnedAssets = function (peer, ownerPublicKey) {
            const message = createMessage(REQUEST_OWNED_ASSETS.TYPE);
            message.set(ownerPublicKey, REQUEST_OWNED_ASSETS.PUBLIC_KEY_OFFSET);
            message.randomizeDezavu();
            peer.transmit(message);
        };

        const requestIssuedAssetsIfNeeded = async function (peer, issuerId, tick) {
            let issuers = issuersByTick.get(tick);
            if (!issuers) {
                issuers = new Map();
                issuersByTick.set(tick, issuers);
            }

            if (!issuers.has(issuerId)) {
                issuers.set(issuerId, []);
                const message = createMessage(REQUEST_ISSUED_ASSETS.TYPE);
                message.set(await idToBytes(issuerId), REQUEST_ISSUED_ASSETS.PUBLIC_KEY_OFFSET);
                message.randomizeDezavu();
                peer.transmit(message);
            }
        };

        const detectQuorumTick = async function (tick, nextQuorumTick) {
            let quorumTick = quorumTicks.get(tick);

            if (!quorumTick) {
                const storedTicks = ticks.get(tick) || [];

                if (storedTicks.filter(storedTick => storedTick !== undefined).length >= QUORUM) {
                    const saltedDigest = new Uint8Array(crypto.DIGEST_LENGTH);
                    const saltedData = new Uint8Array(crypto.PUBLIC_KEY_LENGTH + crypto.DIGEST_LENGTH);

                    const isPrevTick = async function (storedTick) { // verify stored tick matches completed prev tick
                        if (nextQuorumTick) {
                            saltedData.set(storedTick.computorPublicKey);
                            saltedData.set(nextQuorumTick.prevResourceTestingDigest, crypto.PUBLIC_KEY_LENGTH);
                            await crypto.K12(saltedData.subarray(0, crypto.PUBLIC_KEY_LENGTH + BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH), saltedDigest, BROADCAST_TICK.RESOURCE_TESTING_DIGEST_LENGTH);

                            if (equal(saltedDigest, storedTick.saltedResourceTestingDigest)) {
                                saltedData.set(nextQuorumTick.prevSpectrumDigest, crypto.PUBLIC_KEY_LENGTH);
                                await crypto.K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                if (equal(saltedDigest, storedTick.saltedSpectrumDigest)) {
                                    saltedData.set(nextQuorumTick.prevUniverseDigest, crypto.PUBLIC_KEY_LENGTH);
                                    await crypto.K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                    if (equal(saltedDigest, storedTick.saltedUniverseDigest)) {
                                        saltedData.set(nextQuorumTick.prevComputerDigest, crypto.PUBLIC_KEY_LENGTH);
                                        await crypto.K12(saltedData, saltedDigest, crypto.DIGEST_LENGTH);

                                        if (equal(saltedDigest, storedTick.saltedComputerDigest)) {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }

                        return false;
                    };

                    for (let i = 0; i < NUMBER_OF_COMPUTORS; i++) {
                        if (storedTicks[i] !== undefined) {
                            if (!nextQuorumTick || await isPrevTick(storedTicks[i])) {
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
                                            if (!nextQuorumTick || await isPrevTick(storedTicks[j])) {
                                                quorumComputorIndices.push(storedTicks[j].computorIndex);

                                                if (quorumComputorIndices.length === QUORUM) {
                                                    quorumTick = {
                                                        computorIndices: Object.freeze(quorumComputorIndices),
                                                        tick: storedTicks[j].tick,
                                                        epoch: storedTicks[j].epoch,

                                                        timestamp: storedTicks[j].month.toString().padStart(2, '0') + '-' + storedTicks[j].day.toString().padStart(2, '0') + '-' + storedTicks[j].year.toString() +
                                                            'T' + storedTicks[j].hour.toString().padStart(2, '0') + ':' + storedTicks[j].minute.toString().padStart(2, '0') + ':' + storedTicks[j].second.toString().padStart(2, '0') + '.' + storedTicks[j].millisecond.toString().padStart(3, '0'),

                                                        prevResourceTestingDigest: bigUint64ToString(bytesToBigUint64(storedTicks[j].prevResourceTestingDigest)),

                                                        prevSpectrumDigest: digestBytesToString(storedTicks[j].prevSpectrumDigest),
                                                        prevUniverseDigest: digestBytesToString(storedTicks[j].prevUniverseDigest),
                                                        prevComputerDigest: digestBytesToString(storedTicks[j].prevComputerDigest),

                                                        transactionDigest: digestBytesToString(storedTicks[j].transactionDigest),
                                                    };

                                                    if (quorumTicks.size === numberOfStoredTicks) {
                                                        quorumTicks.delete(quorumTicks.keys().next().value);
                                                    }
                                                    quorumTicks.set(quorumTick.tick, quorumTick);

                                                    tickHints.forEach(function (tickHint) {
                                                        if (tickHint <= quorumTick.tick) {
                                                            tickHints.delete(tickHint);
                                                        }
                                                    });

                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    if (quorumComputorIndices.length + (NUMBER_OF_COMPUTORS - j) < QUORUM) {
                                        break;
                                    }
                                }

                                if (quorumTick) {
                                    break;
                                }
                            }
                        }

                        if (i > NUMBER_OF_COMPUTORS - QUORUM) {
                            return undefined;
                        }
                    }
                }
            }

            return quorumTick;
        };

        const verify = async function (tick, peer) {
            const nextQuorumTick = await detectQuorumTick(tick);
            const quorumTick = await detectQuorumTick(tick - 1, nextQuorumTick);

            if (quorumTick && nextQuorumTick) {
                if (system.tick < quorumTick.tick) {
                    if (currentTickInfoRequestingInterval === undefined) {
                        requestCurrentTickInfo(peer);
                        currentTickInfoRequestingInterval = setInterval(() => requestCurrentTickInfo(peer), TARGET_TICK_DURATION);
                    }

                    ticks.forEach(function (tick) {
                        if (tick.tick <= quorumTick.tick) {
                            ticks.delete(tick.tick);
                            voteFlags.delete(tick.tick);
                        }
                    });

                    const now = Date.now();

                    if (system.tick > 0) {
                        const stats = Object.freeze({
                            tick: system.tick,
                            duration: now - (latestQuorumTickTimestamp || startupTime),
                            numberOfSkippedTicks: numberOfSkippedTicks === undefined ? system.initialTick - 1 : numberOfSkippedTicks,
                            numberOfUpdatedEntities,
                            numberOfSkippedEntities: entities.size - numberOfUpdatedEntities,
                            numberOfClearedTransactions,
                        });

                        numberOfSkippedTicks = (quorumTick.tick - 1) - system.tick;

                        that.emit('tick_stats', stats);
                    }

                    latestQuorumTickTimestamp = now;
                    averageQuorumTickProcessingDuration = Math.ceil((latestQuorumTickTimestamp - startupTime) / (quorumTick.tick - (system.initialTick || quorumTick.tick - 1)));

                    system.tick = quorumTick.tick;

                    if (system.initialTick === 0) {
                        system.initialTick = system.tick;
                    }

                    that.emit('tick', Object.freeze({
                        tick: quorumTick.tick,
                        epoch: quorumTick.epoch,
                        timestamp: quorumTick.timestamp,

                        resourceTestingDigest: nextQuorumTick.prevResourceTestingDigest,

                        spectrumDigest: nextQuorumTick.prevSpectrumDigest,
                        universeDigest: nextQuorumTick.prevUniverseDigest,
                        computerDigest: nextQuorumTick.prevComputerDigest,

                        transactionDigest: quorumTick.transactionDigest,
                    }));

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
                            if (isZero(respondedEntity.spectrumDigest) && !isZero(respondedEntity.siblings)) {
                                await crypto.merkleRoot(SPECTRUM_DEPTH, respondedEntity.spectrumIndex, respondedEntity.data, respondedEntity.siblings, respondedEntity.spectrumDigest);
                            }

                            if (digestBytesToString(respondedEntity.spectrumDigest) === nextQuorumTick.prevSpectrumDigest) {
                                const entity = entities.get(respondedEntity.id);

                                if (entity !== undefined && ((entity.tick || 0) < (entity.tick = quorumTick.tick))) {
                                    entitiesByTick.get(quorumTick.tick).delete(respondedEntity.id);
                                    if (entitiesByTick.get(quorumTick.tick).size === 0) {
                                        entitiesByTick.delete(quorumTick.tick);
                                    }

                                    let outgoingTransaction;

                                    if (entity.outgoingTransaction !== undefined && entity.outgoingTransaction.tick <= quorumTick.tick) {
                                        const outgoingTransactionCopy = entity.outgoingTransaction;

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
                                            localStorage.setItem(entity.id + '-' + outgoingTransaction.tick.toString(), localStorage.getItem(entity.id));
                                            localStorage.removeItem(entity.id);
                                        } else {
                                            try {
                                                const path = await importPath;
                                                const fs = await importFs;

                                                const file = path.join(process.cwd(), STORED_ENTITIES_DIR, entity.id);
                                                const archive = file + '-' + outgoingTransaction.tick.toString();

                                                if (fs.existsSync(file)) {
                                                    fs.renameSync(file, archive);
                                                }
                                            } catch (error) {
                                                entity.transaction = outgoingTransactionCopy;
                                                outgoingTransaction = undefined;

                                                that.emit('error', error);
                                            }
                                        }

                                        if (outgoingTransaction !== undefined) {
                                            if (outgoingTransaction.destinationId !== entity.id && (outgoingTransaction.amount > 0n || outgoingTransaction.contractIPO_BidPrice > 0n)) {
                                                that.emit('transfer', outgoingTransaction);
                                            }

                                            numberOfClearedTransactions++;
                                        }
                                    }
        
                                    entity.incomingAmount = respondedEntity.incomingAmount;
                                    entity.outgoingAmount = respondedEntity.outgoingAmount;
                                    entity.energy = entity.incomingAmount - entity.outgoingAmount;
                                    entity.numberOfIncomingTransfers = respondedEntity.numberOfIncomingTransfers;
                                    entity.numberOfOutgoingTransfers = respondedEntity.numberOfOutgoingTransfers;
        
                                    entity.latestIncomingTransferTick = respondedEntity.latestIncomingTransferTick;
                                    entity.latestOutgoingTransferTick = respondedEntity.latestOutgoingTransferTick;
        
                                    entity.tick = quorumTick.tick,
                                    entity.epoch = quorumTick.epoch;
                                    entity.timestamp = quorumTick.timestamp;

                                    entity.siblings = Object.freeze(Array(SPECTRUM_DEPTH).fill('').map((_, i) => digestBytesToString(respondedEntity.siblings.subarray(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH))));
                                    entity.spectrumIndex = respondedEntity.spectrumIndex;
                                    entity.spectrumDigest = nextQuorumTick.prevSpectrumDigest;

                                    const digest = new Uint8Array(crypto.DIGEST_LENGTH);
                                    await crypto.K12(respondedEntity.data, digest, crypto.DIGEST_LENGTH);

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
        
                                        tick: entity.tick,
                                        epoch: entity.epoch,
                                        timestamp: entity.timestamp,
        
                                        digest: digestBytesToString(digest),
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

                if (assetsByTick.has(quorumTick.tick)) {
                    for (const tickAssets of assetsByTick.get(quorumTick.tick).values()) {
                        for (const respondedAsset of tickAssets) {
                            const entity = entities.get(respondedAsset.ownership.ownerId);

                            if (entity !== undefined) {
                                if (isZero(respondedAsset.universeDigest) && !isZero(respondedAsset.siblings)) {
                                    await crypto.merkleRoot(ASSETS_DEPTH, respondedAsset.universeIndex, respondedAsset.data, respondedAsset.siblings, respondedAsset.universeDigest);
                                }

                                if (digestBytesToString(respondedAsset.universeDigest) === nextQuorumTick.prevUniverseDigest) {
                                    const issuers = issuersByTick.get(quorumTick.tick)?.get(respondedAsset.issuance.issuerId);
                                    if (issuers.length > 0) {
                                        for (const issuance of issuers) {
                                            if (issuance.universeIndex === respondedAsset.ownership.issuanceIndex) {
                                                if (isZero(issuance.universeDigest) && !isZero(issuance.siblings)) {
                                                    await crypto.merkleRoot(ASSETS_DEPTH, issuance.universeIndex, issuance.data, issuance.siblings, issuance.universeDigest);
                                                }

                                                if (digestBytesToString(issuance.universeDigest) === nextQuorumTick.prevUniverseDigest) {
                                                    if (assetsByTick.has(quorumTick.tick)) {
                                                        assetsByTick.get(quorumTick.tick).delete(respondedAsset.ownership.ownerId);
                                                        if (assetsByTick.get(quorumTick.tick).size === 0) {
                                                            assetsByTick.delete(quorumTick.tick);
                                                            issuersByTick.delete(quorumTick.tick);
                                                        }
                                                    }

                                                    const digest = new Uint8Array(crypto.DIGEST_LENGTH);
                                                    await crypto.K12(respondedAsset.data, digest, crypto.DIGEST_LENGTH);
                                                    const ownershipDigest = digestBytesToString(digest);

                                                    await crypto.K12(issuance.data, digest, crypto.DIGEST_LENGTH);
                                                    const issuanceDigest = digestBytesToString(digest);

                                                    that.emit('asset', Object.freeze({
                                                        ownership: Object.freeze(respondedAsset.ownership),
                                                        issuance: Object.freeze({
                                                            issuerId: issuance.issuerId,
                                                            type: issuance.type,
                                                            name: issuance.name,
                                                            numberOfDecimalPlaces: issuance.numberOfDecimalPlaces,
                                                            unitOfMeasurement: Object.freeze(issuance.unitOfMeasurement),

                                                            digest: issuanceDigest,
                                                            siblings: Object.freeze(Array(ASSETS_DEPTH).fill('').map((_, i) => digestBytesToString(issuance.siblings.subarray(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH)))),
                                                            universeIndex: issuance.universeIndex,
                                                            universeDigest: nextQuorumTick.prevUniverseDigest,
                                                        }),

                                                        tick: quorumTick.tick,
                                                        epoch: quorumTick.epoch,
                                                        timestamp: quorumTick.timestamp,

                                                        digest: ownershipDigest,
                                                        siblings: Object.freeze(Array(ASSETS_DEPTH).fill('').map((_, i) => digestBytesToString(respondedAsset.siblings.subarray(i * crypto.DIGEST_LENGTH, (i + 1) * crypto.DIGEST_LENGTH)))),
                                                        universeIndex: respondedAsset.universeIndex,
                                                        universeDigest: nextQuorumTick.prevUniverseDigest,
                                                    }));
                                                }
                                            }
                                        }
                                    }

                                    break;
                                }
                            }

                            if (!assetsByTick.get(quorumTick.tick).has(respondedAsset.ownership.ownerId)) {
                                break;
                            }
                        }

                        if (!assetsByTick.has(quorumTick.tick)) {
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
                            computorIds: new Array(NUMBER_OF_COMPUTORS).fill(NULL_ID_STRING),

                            digest: new Uint8Array(crypto.DIGEST_LENGTH),
                            signature: message.subarray(BROADCAST_COMPUTORS.SIGNATURE_OFFSET),

                            faultyComputorFlags: new Array(NUMBER_OF_COMPUTORS).fill(false),
                        };

                        const inferredEpoch = inferEpoch();

                        if (receivedComputors.epoch <= inferredEpoch) {
                            await crypto.K12(message.subarray(BROADCAST_COMPUTORS.EPOCH_OFFSET, BROADCAST_COMPUTORS.SIGNATURE_OFFSET), receivedComputors.digest, crypto.DIGEST_LENGTH);

                            if (await crypto.verify(await ARBITRATOR_BYTES, receivedComputors.digest, receivedComputors.signature)) {

                                await tickLock.acquire();

                                if (system.epoch === 0) {
                                    const checkpointBytes = new Uint8Array(BROADCAST_COMPUTORS.EPOCH_LENGTH + BROADCAST_COMPUTORS.PUBLIC_KEYS_LENGTH);
                                    const checkpointBytesView = new DataView(checkpointBytes.buffer, checkpointBytes.byteOffset);
                                    const checkpoint = {
                                        epoch: CHECKPOINT.epoch,
                                        computorPublicKeys: await Promise.all(CHECKPOINT.computorIds.map(id => idToBytes(id))),
                                        computorIds: CHECKPOINT.computorIds,

                                        digest: new Uint8Array(crypto.DIGEST_LENGTH),
                                        signature: stringToBytes64(CHECKPOINT.signature),

                                        faultyComputorFlags: new Array(NUMBER_OF_COMPUTORS).fill(false),
                                    };

                                    checkpointBytesView.setUint16(0, CHECKPOINT.epoch, true);
                                    for (let i = 0, offset = BROADCAST_COMPUTORS.EPOCH_LENGTH; i < NUMBER_OF_COMPUTORS; i++, offset += crypto.PUBLIC_KEY_LENGTH) {
                                        checkpointBytes.set(checkpoint.computorPublicKeys[i], offset);
                                    }

                                    await crypto.K12(checkpointBytes, checkpoint.digest, crypto.DIGEST_LENGTH);

                                    if (await crypto.verify(await ARBITRATOR_BYTES, checkpoint.digest, checkpoint.signature)) {
                                        epochs.set((system.epoch = CHECKPOINT.epoch), checkpoint);

                                        that.emit('epoch', Object.freeze({
                                            epoch: checkpoint.epoch,
                                            computorIds: Object.freeze(checkpoint.computorIds),

                                            digest: digestBytesToString(checkpoint.digest),
                                            signature: CHECKPOINT.signature,
                                        }));

                                        if (quorumTickRequestingInterval === undefined && currentTickInfoRequestingInterval === undefined) {
                                            requestCurrentTickInfo(peer);
                                        }
                                    } else {
                                        throw new Error('Invalid checkpoint signature!');
                                    }
                                }

                                if (epochs.has(receivedComputors.epoch)) {
                                    if (equal(epochs.get(receivedComputors.epoch).digest, receivedComputors.digest)) {
                                        if (receivedComputors.epoch > system.epoch) {
                                            uniquePeersByEpoch.get(receivedComputors.epoch).add(peer.address);

                                            for (let i = system.epoch + 1; i <= inferredEpoch; i++) {
                                                if (!epochs.has(i) || (uniquePeersByEpoch.get(i).size < (Math.floor((2 / 3) * MIN_NUMBER_OF_PUBLIC_PEERS) + 1))) {
                                                    tickLock.release();
                                                    return;
                                                }
                                            }
                                            for (let i = system.epoch; i < inferredEpoch; i++) {
                                                let numberOfReplacedComputors = 0;

                                                for (let j = 0; j < NUMBER_OF_COMPUTORS; j++) {
                                                    if (epochs.get(i + 1).computorIds.indexOf(epochs.get(i).computorIds[j]) === -1) {
                                                        if (++numberOfReplacedComputors > NUMBER_OF_COMPUTORS - QUORUM) {
                                                            system.epoch = 0x10000;
                                                            that.emit('error', new Error(`Illegal number of replaced computors! (epoch ${i + 1}). Replace arbitrator.`));
                                                        }
                                                    }
                                                }
                                            }

                                            if (inferredEpoch > system.epoch) {
                                                const epoch = epochs.get(inferredEpoch);

                                                system.epoch = epoch.epoch;

                                                that.emit('epoch', Object.freeze({
                                                    epoch: epoch.epoch,
                                                    computorIds: Object.freeze(epoch.computorIds),

                                                    digest: digestBytesToString(epoch.digest),
                                                    signature: bytes64ToString(epoch.signature),
                                                }));
                                            }

                                            if (quorumTickRequestingInterval === undefined && currentTickInfoRequestingInterval === undefined) {
                                                requestCurrentTickInfo(peer);
                                            }
                                        }
                                    } else {
                                        system.epoch = 0x10000;
                                        that.emit('error', new Error('Replace arbitrator.'));
                                    }
                                } else {
                                    if (receivedComputors.epoch > system.epoch) {
                                        for (let i = 0, offset = BROADCAST_COMPUTORS.PUBLIC_KEYS_OFFSET; i < NUMBER_OF_COMPUTORS; i++) {
                                            receivedComputors.computorPublicKeys[i] = message.slice(offset, (offset += crypto.PUBLIC_KEY_LENGTH));
                                            receivedComputors.computorIds[i] = await bytesToId(receivedComputors.computorPublicKeys[i]);
                                        }
                                        epochs.set(receivedComputors.epoch, receivedComputors);

                                        const uniquePeers = new Set();
                                        uniquePeers.add(peer.address);
                                        uniquePeersByEpoch.set(receivedComputors.epoch, uniquePeers);
                                    }
                                }
                            } else {
                                peer.ignore();
                            }

                            tickLock.release();
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

                        await tickLock.acquire();

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
                                    message[BROADCAST_TICK.COMPUTOR_INDEX_OFFSET] ^= BROADCAST_TICK.TYPE;
                                    await crypto.K12(message.subarray(BROADCAST_TICK.COMPUTOR_INDEX_OFFSET, BROADCAST_TICK.SIGNATURE_OFFSET), receivedTick.digest, crypto.DIGEST_LENGTH);
                                    message[BROADCAST_TICK.COMPUTOR_INDEX_OFFSET] ^= BROADCAST_TICK.TYPE;

                                    if (await crypto.verify(receivedTick.computorPublicKey, receivedTick.digest, receivedTick.signature)) {
                                        const storedTick = ticks.get(receivedTick.tick)?.[computorIndex];

                                        if (storedTick === undefined) {
                                            if (ticks.get(receivedTick.tick) === undefined) {
                                                ticks.set(receivedTick.tick, Array(NUMBER_OF_COMPUTORS).fill(undefined));
                                            }

                                            ticks.get(receivedTick.tick)[computorIndex] = receivedTick;

                                            await verify(receivedTick.tick, peer);
                                        } else if (
                                            !equal(receivedTick.time, storedTick.time) &&
                                            !equal(receivedTick.prevSpectrumDigest, storedTick.prevSpectrumDigest) &&
                                            !equal(receivedTick.prevUniverseDigest, storedTick.prevUniverseDigest) &&
                                            !equal(receivedTick.prevComputerDigest, storedTick.prevComputerDigest) &&
                                            !equal(receivedTick.transactionDigest, storedTick.transactionDigest) &&
                                            !equal(receivedTick.expectedNextTickTransactionDigest, storedTick.expectedNextTickTransactionDigest)
                                        ) {
                                            // TODO: publish proof on blockchain
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

                        tickLock.release();
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
                                requestOwnedAssets(peer, entity.publicKey);
                            });

                            clearInterval(currentTickInfoRequestingInterval);
                            currentTickInfoRequestingInterval = undefined;
                            if (!tickHints.has(tickHint)) {
                                tickHints.add(tickHint);

                                requestQuorumTick(peer, tickHint);
                                requestQuorumTick(peer, tickHint + 1);

                                clearInterval(quorumTickRequestingInterval);
                                quorumTickRequestingInterval = setInterval(async () => {
                                    await tickLock.acquire();
                                    let tick = tickHint > system.tick ? tickHint - 1 : system.tick + 1;
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
                                    tickLock.release();
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
                            data: message.slice(RESPOND_ENTITY.PUBLIC_KEY_OFFSET, RESPOND_ENTITY.LATEST_OUTGOING_TRANSFER_TICK_OFFSET + BROADCAST_TICK.TICK_LENGTH),
                            tick: messageView.getUint32(RESPOND_ENTITY.TICK_OFFSET, true),
                            spectrumIndex: messageView.getUint32(RESPOND_ENTITY.SPECTRUM_INDEX_OFFSET, true),
                            siblings: message.subarray(RESPOND_ENTITY.SIBLINGS_OFFSET, RESPOND_ENTITY.SIBLINGS_OFFSET + RESPOND_ENTITY.SIBLINGS_LENGTH),
                            spectrumDigest: new Uint8Array(crypto.DIGEST_LENGTH),
                            peer,
                        };

                        await tickLock.acquire();

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

                                await verify(respondedEntity.tick, peer);
                            }
                        }

                        tickLock.release();
                    } else {
                        peer.ignore();
                    }
                    break;

                case RESPOND_ISSUED_ASSETS.TYPE:
                    if (message.length === RESPOND_ISSUED_ASSETS.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);
                        const respondedAsset = {
                            issuerId: await bytesToId(message.subarray(RESPOND_ISSUED_ASSETS.ISSUANCE_PUBLIC_KEY_OFFSET, RESPOND_ISSUED_ASSETS.ISSUANCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
                            type: message[RESPOND_ISSUED_ASSETS.ISSUANCE_TYPE_OFFSET],
                            name: bytesToString(message.subarray(RESPOND_ISSUED_ASSETS.NAME_OFFSET, RESPOND_ISSUED_ASSETS.NAME_OFFSET + RESPOND_ISSUED_ASSETS.NAME_LENGTH)),
                            numberOfDecimalPlaces: message[RESPOND_ISSUED_ASSETS.NUMBER_OF_DECIMAL_PLACES_OFFSET],
                            unitOfMeasurement: Array.from(message.slice(RESPOND_ISSUED_ASSETS.UNIT_OF_MEASUREMENT_OFFSET, RESPOND_ISSUED_ASSETS.UNIT_OF_MEASUREMENT_OFFSET + RESPOND_OWNED_ASSETS.UNIT_OF_MEASUREMENT_LENGTH)),

                            tick: messageView.getUint32(RESPOND_ISSUED_ASSETS.TICK_OFFSET, true),
                            universeIndex: messageView.getUint32(RESPOND_ISSUED_ASSETS.UNIVERSE_INDEX_OFFSET, true),
                            siblings: message.subarray(RESPOND_ISSUED_ASSETS.SIBLINGS_OFFSET, RESPOND_ISSUED_ASSETS.SIBLINGS_OFFSET + ASSETS_DEPTH * crypto.DIGEST_LENGTH),

                            data: message.slice(RESPOND_ISSUED_ASSETS.ISSUANCE_PUBLIC_KEY_OFFSET, RESPOND_ISSUED_ASSETS.UNIT_OF_MEASUREMENT_OFFSET + RESPOND_ISSUED_ASSETS.UNIT_OF_MEASUREMENT_LENGTH),
                            universeDigest: new Uint8Array(crypto.DIGEST_LENGTH),

                            peer,
                        };

                        await tickLock.acquire();

                        if (respondedAsset.universeIndex > -1) {
                            if (respondedAsset.type === ASSET_TYPES.ISSUANCE) {
                                const issuers = issuersByTick.get(respondedAsset.tick);
                                if (issuers !== undefined) {
                                    const assets = issuers.get(respondedAsset.issuerId);
                                    if (assets !== undefined) {
                                        assets.push(respondedAsset);
                                    }
                                }
                            }
                        }

                        tickLock.release();
                    }
                    break;

                case RESPOND_OWNED_ASSETS.TYPE:
                    if (message.length === RESPOND_OWNED_ASSETS.LENGTH) {
                        const messageView = new DataView(message.buffer, message.byteOffset);

                        const respondedAsset = {
                            ownership: {
                                ownerId: await bytesToId(message.subarray(RESPOND_OWNED_ASSETS.OWNERSHIP_PUBLIC_KEY_OFFSET, RESPOND_OWNED_ASSETS.OWNERSHIP_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
                                type: message[RESPOND_OWNED_ASSETS.OWNERSHIP_TYPE_OFFSET],
                                managingContractIndex: messageView.getUint16(RESPOND_OWNED_ASSETS.OWNERSHIP_MANAGING_CONTRACT_INDEX_OFFSET, true),
                                issuanceIndex: messageView.getUint32(RESPOND_OWNED_ASSETS.ISSUANCE_INDEX_OFFSET, true),
                                numberOfShares: messageView.getBigUint64(RESPOND_OWNED_ASSETS.NUMBER_OF_OWNED_SHARES_OFFSET, true),
                            },
                            issuance: {
                                issuerId: await bytesToId(message.subarray(RESPOND_OWNED_ASSETS.ISSUANCE_PUBLIC_KEY_OFFSET, RESPOND_OWNED_ASSETS.ISSUANCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
                                type: message[RESPOND_OWNED_ASSETS.ISSUANCE_TYPE_OFFSET],
                                name: bytesToString(message.subarray(RESPOND_OWNED_ASSETS.NAME_OFFSET, RESPOND_OWNED_ASSETS.NAME_OFFSET + RESPOND_OWNED_ASSETS.NAME_LENGTH)),
                                numberOfDecimalPlaces: message[RESPOND_OWNED_ASSETS.NUMBER_OF_DECIMAL_PLACES_OFFSET],
                                unitOfMeasurement: Array.from(message.slice(RESPOND_OWNED_ASSETS.UNIT_OF_MEASUREMENT_OFFSET, RESPOND_OWNED_ASSETS.UNIT_OF_MEASUREMENT_OFFSET + RESPOND_OWNED_ASSETS.UNIT_OF_MEASUREMENT_LENGTH)),
                            },

                            tick: messageView.getUint32(RESPOND_OWNED_ASSETS.TICK_OFFSET, true),
                            universeIndex: messageView.getUint32(RESPOND_OWNED_ASSETS.UNIVERSE_INDEX_OFFSET, true),
                            siblings: message.subarray(RESPOND_OWNED_ASSETS.SIBLINGS_OFFSET, RESPOND_OWNED_ASSETS.SIBLINGS_OFFSET + ASSETS_DEPTH * crypto.DIGEST_LENGTH),

                            data: message.slice(RESPOND_OWNED_ASSETS.OWNERSHIP_PUBLIC_KEY_OFFSET, RESPOND_OWNED_ASSETS.NUMBER_OF_OWNED_SHARES_OFFSET + RESPOND_OWNED_ASSETS.NUMBER_OF_SHARES_LENGTH),
                            universeDigest: new Uint8Array(crypto.DIGEST_LENGTH),

                            peer,
                        };

                        await tickLock.acquire();

                        if (respondedAsset.universeIndex > -1) {
                            if (respondedAsset.issuance.type === ASSET_TYPES.ISSUANCE && respondedAsset.ownership.type === ASSET_TYPES.OWNERSHIP) {
                                if (entities.has(respondedAsset.ownership.ownerId)) {
                                    let tickAssets = assetsByTick.get(respondedAsset.tick);
                                    if (tickAssets === undefined) {
                                        tickAssets = new Map();
                                        assetsByTick.set(respondedAsset.tick, tickAssets);
                                    }

                                    if (!tickAssets.has(respondedAsset.ownership.ownerId)) {
                                        tickAssets.set(respondedAsset.ownership.ownerId, []);
                                    }
                                    tickAssets.get(respondedAsset.ownership.ownerId).push(respondedAsset);

                                    requestIssuedAssetsIfNeeded(peer, respondedAsset.issuance.issuerId, respondedAsset.tick);

                                    await verify(respondedAsset.tick,  peer);
                                }
                            }
                        }

                        tickLock.release();

                    } else {
                        peer.ignore();
                    }
                    break;
            }
        };

        const transceiver = createTransceiver(receiveCallback);
        transceiver.addListener('network', network => that.emit('network', network));

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

                        const transactionLock = createLock();
                        const executionTickLock = createLock();

                        await tickLock.acquire();

                        let entity = entities.get(id);
                        if (entity === undefined) {
                            entities.set(id, (entity = {
                                id,
                                publicKey: await crypto.generatePublicKey(privateKey),
                                outgoingTransaction: undefined,
                                emitter: those,
                            }));
                        } else {
                            if (entity.emitter !== undefined) {
                                tickLock.release();
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

                            try  {
                                if (fs.existsSync(dir)) {
                                    if (fs.existsSync(temp)) {
                                        fs.unlinkSync(temp);
                                    } else if (fs.existsSync(file)) {
                                        const buffer = fs.readFileSync(file);
                                        storedTransactionBytes = Uint8Array.from(buffer);
                                    }
                                }
                            } catch (error) {
                                tickLock.release();
                                throw error;
                            }
                        }

                        if (storedTransactionBytes !== undefined) {
                            // TODO: decrypt
                            let storedTransaction;

                            try {
                                storedTransaction = await inspectTransaction(storedTransactionBytes);
                            } catch (error) {
                                tickLock.release();
                                throw error;
                            }

                            if (storedTransaction.sourceId !== id) {
                                tickLock.release();
                                throw new Error('Invalid stored transaction!');
                            }

                            entity.outgoingTransaction = storedTransaction;
                        }

                        tickLock.release();

                        return Object.assign(
                            those,
                            {
                                get id() {
                                    return id;
                                },

                                async executionTick() {
                                    await executionTickLock.acquire();

                                    return new Promise(function (resolve) {
                                        those.once('execution_tick', function (tick) {
                                            executionTickLock.release();
                                            resolve(tick);
                                        });
                                    });
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
                                    await transactionLock.acquire();
                                    await tickLock.acquire();

                                    try {
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

                                        if (tick !== undefined) {
                                            if (!Number.isInteger(tick)) {
                                                throw new TypeError('Invalid transaction tick!');
                                            }
                                            if (tick < system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET + Math.ceil(averageQuorumTickProcessingDuration / TARGET_TICK_DURATION) + 1) {
                                                throw new RangeError('Transaction tick not far enough in the future...');
                                            }
                                            if (tick - system.tick > Math.floor((60 * 1000) / TARGET_TICK_DURATION)) { // avoid timelocks as a result of setting tick too far in the future.
                                                throw new RangeError('Transaction tick too far in the future!');
                                            }
                                        } else {
                                            tick = await those.executionTick();
                                        }

                                        entity.outgoingTransaction = await createTransaction(sourcePrivateKey, {
                                            sourceId: id,
                                            destinationId,
                                            amount,
                                            tick,
                                            inputType,
                                            input,
                                            contractIPO_BidPrice,
                                            contractIPO_BidQuantity,
                                        });
                                    } catch (error) {
                                        tickLock.release();
                                        transactionLock.release();

                                        throw error;
                                    }

                                    if (IS_BROWSER) {
                                        // TODO: encrypt
                                        localStorage.setItem(id, bytesToShiftedHex(entity.outgoingTransaction.bytes));
                                    } else {
                                        const path = await importPath;
                                        const fs = await importFs;

                                        const dir = path.join(process.cwd(), STORED_ENTITIES_DIR);
                                        const file = path.join(dir, id);
                                        const temp = file + '-temp';

                                        try {
                                            if (!fs.existsSync(dir)) {
                                                fs.mkdirSync(dir);
                                            }

                                            // TODO: encrypt
                                            fs.writeFileSync(temp, Uint8Array.from(entity.outgoingTransaction.bytes));
                                            fs.renameSync(temp, file);
                                        } catch (error) {
                                            entity.outgoingTransaction = undefined;

                                            tickLock.release();
                                            transactionLock.release();

                                            throw error;
                                        }
                                    }

                                    tickLock.release();
                                    transactionLock.release();

                                    return entity.outgoingTransaction;
                                },

                                broadcastTransaction() {
                                    if (entity.outgoingTransaction !== undefined && entity.outgoingTransaction.tick > system.tick + TICK_TRANSACTIONS_PUBLICATION_OFFSET) {
                                        _broadcastTransaction(entity.outgoingTransaction.bytes);
                                    }
                                },

                                async removeTransaction(tick) {
                                    if (entity.outgoingTransaction !== undefined) {
                                        if (entity.outgoingTransaction.tick === tick) {
                                            throw new Error('Transaction is pending, cannot be removed from archive');
                                        }
                                    }

                                    if (IS_BROWSER) {
                                        const transaction = localStorage.getItem(entity.id + '-' + tick.toString());

                                        if (transaction) {
                                            localStorage.setItem(entity.id, transaction);
                                            localStorage.removeItem(entity.id);
                                        } else {
                                            throw new Error(`Transaction does not exist. (id: ${entity.id}, tick: ${tick.toString()})`);
                                        }
                                    } else {
                                        const path = await importPath;
                                        const fs = await importFs;

                                        const archive = path.join(process.cwd(), STORED_ENTITIES_DIR, entity.id + '-' + tick.toString());

                                        if (fs.existsSync(archive)) {
                                            fs.unlinkSync(archive);
                                        } else {
                                            throw new Error(`Transaction does not exist. (id: ${entity.id}, tick: ${tick.toString()})`);
                                        }
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
