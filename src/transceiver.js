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

import crypto from 'qubic-crypto';
import { NUMBER_OF_COMPUTORS, SPECTRUM_DEPTH, TARGET_TICK_DURATION } from './constants.js';
import { TRANSACTION } from './transaction.js';
import { IS_BROWSER } from './utils.js';

import pkg from '../package.json' assert { type: 'json' };

const CORE_PORT = 21841;
const PROXY_PORT = 22841;

const DEJAVU_SWAP_LIMIT = 1000000;

export const MIN_NUMBER_OF_PUBLIC_PEERS = 4;
export const MAX_NUMBER_OF_PUBLIC_PEERS = 1024;
export const PEER_ROTATION_PERIOD = 2 * 60 * 1000;

export const COMMUNICATION_PROTOCOLS = {
    TCP: 'tcp',
    WEBSOCKET: 'ws',
    // WEBRTC: 'webrtc',
    get DEFAULT() {
        return this.TCP;
    },
};

export const REQUEST_RESPONSE_HEADER = {
    SIZE_OFFSET: 0,
    SIZE_LENGTH: 3,
    MAX_SIZE: 0xFFFFFF,
    get TYPE_OFFSET() {
        return this.SIZE_OFFSET + this.SIZE_LENGTH;
    },
    TYPE_LENGTH: 1,
    get DEJAVU_OFFSET() {
        return this.TYPE_OFFSET + this.TYPE_LENGTH;
    },
    DEJAVU_LENGTH: 4,
    get LENGTH() {
        return this.DEJAVU_OFFSET + this.DEJAVU_LENGTH;
    },
};

export const EXCHANGE_PUBLIC_PEERS = {
    TYPE: 0,

    NUMBER_OF_EXCHANGED_PEERS: 4,
    ADDRESS_LENGTH: 4,
    EXCHANGED_PEERS_OFFSET: 0,
    get EXCHANGED_PEERS_LENGTH() {
        return this.NUMBER_OF_EXCHANGED_PEERS * this.ADDRESS_LENGTH;
    },
    get LENGTH() {
        return this.EXCHANGED_PEERS_OFFSET + this.EXCHANGED_PEERS_LENGTH;
    },
};

export const BROADCAST_MESSAGE = {
    TYPE: 1,

    SOURCE_PUBLIC_KEY_OFFSET: 0,
    get DESTINATION_PUBLIC_KEY_OFFSET() {
        return this.SOURCE_PUBLIC_KEY_OFFSET + crypto.DIGEST_LENGTH;
    },
    get GAMMING_NONCE_OFFSET() {
        return this.DESTINATION_PUBLIC_KEY_OFFSET + crypto.NONCE_LENGTH;
    },
    GAMMING_NONCE_LENGTH: crypto.PUBLIC_KEY_LENGTH,

    MAX_PAYLOAD_SIZE: 1024,

    get MIN_LENGTH() {
        return this.GAMMING_NONCE_OFFSET + this.GAMMING_NONCE_LENGTH + crypto.SIGNATURE_LENGTH;
    },
    get MAX_LENGTH() {
        return this.MIN_LENGTH + this.MAX_PAYLOAD_SIZE;
    },
    length(payloadSize) {
        if (payloadSize < 0 || payloadSize > this.MAX_PAYLOAD_SIZE) {
            throw new RangeError('Invalid payload size.');
        }
        return this.MIN_LENGTH + payloadSize;
    },
};

export const BROADCAST_COMPUTORS = {
    TYPE: 2,

    EPOCH_OFFSET: 0,
    EPOCH_LENGTH: 2,
    get PUBLIC_KEYS_OFFSET() {
        return this.EPOCH_OFFSET + this.EPOCH_LENGTH;
    },
    get PUBLIC_KEYS_LENGTH() {
        return NUMBER_OF_COMPUTORS * crypto.PUBLIC_KEY_LENGTH;
    },
    get SIGNATURE_OFFSET() {
        return this.PUBLIC_KEYS_OFFSET + this.PUBLIC_KEYS_LENGTH;
    },

    get LENGTH() {
        return this.SIGNATURE_OFFSET + crypto.SIGNATURE_LENGTH;
    },
};

export const BROADCAST_TICK = {
    TYPE: 3,

    COMPUTOR_INDEX_OFFSET: 0,
    COMPUTOR_INDEX_LENGTH: 2,
    get EPOCH_OFFSET() {
        return this.COMPUTOR_INDEX_OFFSET + this.COMPUTOR_INDEX_LENGTH
    },
    EPOCH_LENGTH: BROADCAST_COMPUTORS.EPOCH_LENGTH,
    get TICK_OFFSET() {
        return this.EPOCH_OFFSET + this.EPOCH_LENGTH;
    },
    TICK_LENGTH: TRANSACTION.TICK_LENGTH,

    get TIME_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    TIME_LENGTH: 8,
    get MILLISECOND_OFFSET() {
        return this.TIME_OFFSET;
    },
    MILLISECOND_LENGTH: 2,
    get SECOND_OFFSET() {
        return this.MILLISECOND_OFFSET + this.MILLISECOND_LENGTH;
    },
    get MINUTE_OFFSET() {
        return this.SECOND_OFFSET + 1;
    },
    get HOUR_OFFSET() {
        return this.MINUTE_OFFSET + 1;
    },
    get DAY_OFFSET() {
        return this.HOUR_OFFSET + 1;
    },
    get MONTH_OFFSET() {
        return this.DAY_OFFSET + 1;
    },
    get YEAR_OFFSET() {
        return this.MONTH_OFFSET + 1;
    },

    RESOURCE_TESTING_DIGEST_LENGTH: 8,
    get PREV_RESOURCE_TESTING_DIGEST_OFFSET() {
        return this.YEAR_OFFSET + 1;
    },
    get SALTED_RESOURCE_TESTING_DIGEST_OFFSET() {
        return this.PREV_RESOURCE_TESTING_DIGEST_OFFSET + this.RESOURCE_TESTING_DIGEST_LENGTH;
    },

    get PREV_SPECTRUM_DIGEST_OFFSET() {
        return this.SALTED_RESOURCE_TESTING_DIGEST_OFFSET + this.RESOURCE_TESTING_DIGEST_LENGTH;
    },
    get PREV_UNIVERSE_DIGEST_OFFSET() {
        return this.PREV_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },
    get PREV_COMPUTER_DIGEST_OFFSET() {
        return this.PREV_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },
    get SALTED_SPECTRUM_DIGEST_OFFSET() {
        return this.PREV_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },
    get SALTED_UNIVERSE_DIGEST_OFFSET() {
        return this.SALTED_SPECTRUM_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },
    get SALTED_COMPUTER_DIGEST_OFFSET() {
        return this.SALTED_UNIVERSE_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },

    get TRANSACTION_DIGEST_OFFSET() {
        return this.SALTED_COMPUTER_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },
    get EXPECTED_NEXT_TICK_TRANSACTION_DIGEST_OFFSET() {
        return this.TRANSACTION_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },

    get SIGNATURE_OFFSET() {
        return this.EXPECTED_NEXT_TICK_TRANSACTION_DIGEST_OFFSET + crypto.DIGEST_LENGTH;
    },

    get LENGTH() {
        return this.SIGNATURE_OFFSET + crypto.SIGNATURE_LENGTH;
    },
};

export const REQUEST_COMPUTORS = {
    TYPE: 11,
    LENGTH: 0,

    LRV_EPOCH_OFFSET: 0,
    LRV_EPOCH_LENGTH: BROADCAST_COMPUTORS.EPOCH_LENGTH,
    get LRV_LENGTH() {
        return this.LRV_EPOCH_OFFSET + this.LRV_EPOCH_LENGTH;
    },
};

export const REQUEST_QUORUM_TICK = {
    TYPE: 14,

    TICK_OFFSET: 0,
    TICK_LENGTH: BROADCAST_TICK.LENGTH,
    get VOTE_FLAGS_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    VOTE_FLAGS_LENGTH: Math.floor((NUMBER_OF_COMPUTORS + 7) / 8),

    get LENGTH() {
        return this.VOTE_FLAGS_OFFSET + this.VOTE_FLAGS_LENGTH;
    },
};

export const BROADCAST_TRANSACTION = {
    TYPE: 24,

    SOURCE_PUBLIC_KEY_OFFSET: 0,
    get DESTINATION_PUBLIC_KEY_OFFSET() {
        return this.SOURCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get AMOUNT_OFFSET() {
        return this.DESTINATION_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    AMOUNT_LENGTH: TRANSACTION.AMOUNT_LENGTH,
    get TICK_OFFSET() {
        return this.AMOUNT_OFFSET + this.AMOUNT_LENGTH;
    },
    TICK_LENGTH: TRANSACTION.TICK_LENGTH,
    
    get INPUT_TYPE_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    INPUT_TYPE_LENGTH: TRANSACTION.INPUT_TYPE_LENGTH,
    get INPUT_SIZE_OFFSET() {
        return this.INPUT_TYPE_OFFSET + this.INPUT_TYPE_LENGTH;
    },
    INPUT_SIZE_LENGTH: TRANSACTION.INPUT_SIZE_LENGTH,

    MAX_INPUT_SIZE: TRANSACTION.MAX_INPUT_SIZE,

    get MIN_LENGTH() {
        return this.INPUT_SIZE_OFFSET + this.INPUT_SIZE_LENGTH + crypto.SIGNATURE_LENGTH;
    },
    get MAX_LENGTH() {
        return this.MIN_LENGTH + this.MAX_INPUT_SIZE;
    },
    length(inputSize) {
        if (inputSize < 0 || inputSize > this.MAX_INPUT_SIZE) {
            throw new RangeError('Invalid input size.');
        }
        return this.MIN_LENGTH + inputSize;
    },

    get CONTRACT_IPO_BID_PRICE_OFFSET() {
        return this.MIN_LENGTH;
    },
    get CONTRACT_IPO_BID_PRICE_LENGTH() {
        return this.AMOUNT_LENGTH;
    },
    get CONTRACT_IPO_BID_QUANTITY_OFFSET() {
        return this.CONTRACT_IPO_BID_PRICE_OFFSET + this.CONTRACT_IPO_BID_PRICE_LENGTH;
    },
    CONTRACT_IPO_BID_QUANTITY_LENGTH: 2,
};

export const REQUEST_CURRENT_TICK_INFO = {
    TYPE: 27,
    LENGTH: 0,
};

export const RESPOND_CURRENT_TICK_INFO = {
    TYPE: 28,

    TICK_DURATION_OFFSET: 0,
    TICK_DURATION_LENGTH: 2,
    get EPOCH_OFFSET() {
        return this.TICK_DURATION_OFFSET + this.TICK_DURATION_LENGTH;
    },
    EPOCH_LENGTH: BROADCAST_COMPUTORS.EPOCH_LENGTH,
    get TICK_OFFSET() {
        return this.EPOCH_OFFSET + this.EPOCH_LENGTH;
    },
    TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,
    get NUMBER_OF_ALIGNED_VOTES_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    NUMBER_OF_ALIGNED_VOTES_LENGTH: 2,
    get NUMBER_OF_MISALIGNED_VOTES_OFFSET() {
        return this.NUMBER_OF_ALIGNED_VOTES_OFFSET + this.NUMBER_OF_ALIGNED_VOTES_LENGTH;
    },
    get NUMBER_OF_MISALIGNED_VOTES_LENGTH() {
        return this.NUMBER_OF_ALIGNED_VOTES_LENGTH;
    },
    get INITIAL_TICK_OFFSET() {
        return this.NUMBER_OF_MISALIGNED_VOTES_OFFSET + this.NUMBER_OF_MISALIGNED_VOTES_LENGTH;
    },
    INITIAL_TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,

    get LENGTH() {
        return this.INITIAL_TICK_OFFSET + this.INITIAL_TICK_LENGTH;
    },
};

export const REQUEST_ENTITY = {
    TYPE: 31,

    PUBLIC_KEY_OFFSET: 0,

    get LENGTH() {
        return this.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
};

export const RESPOND_ENTITY = {
    TYPE: 32,

    PUBLIC_KEY_OFFSET: 0,
    AMOUNT_LENGTH: BROADCAST_TRANSACTION.AMOUNT_LENGTH,
    get INCOMING_AMOUNT_OFFSET() {
        return this.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get OUTGOING_AMOUNT_OFFSET() {
        return this.INCOMING_AMOUNT_OFFSET + this.AMOUNT_LENGTH;
    },
    NUMBER_OF_TRANSFERS_LENGTH: 4,
    get NUMBER_OF_INCOMING_TRANSFERS_OFFSET() {
        return this.OUTGOING_AMOUNT_OFFSET + this.AMOUNT_LENGTH;
    },
    get NUMBER_OF_OUTGOING_TRANSFERS_OFFSET() {
        return this.NUMBER_OF_INCOMING_TRANSFERS_OFFSET + this.NUMBER_OF_TRANSFERS_LENGTH;
    },
    get LATEST_INCOMING_TRANSFER_TICK_OFFSET() {
        return this.NUMBER_OF_OUTGOING_TRANSFERS_OFFSET + this.NUMBER_OF_TRANSFERS_LENGTH;
    },
    get LATEST_OUTGOING_TRANSFER_TICK_OFFSET() {
        return this.LATEST_INCOMING_TRANSFER_TICK_OFFSET + BROADCAST_TICK.TICK_LENGTH;
    },

    get TICK_OFFSET() {
        return this.LATEST_OUTGOING_TRANSFER_TICK_OFFSET + BROADCAST_TICK.TICK_LENGTH;
    },
    get SPECTRUM_INDEX_OFFSET() {
        return this.TICK_OFFSET + BROADCAST_TICK.TICK_LENGTH;
    },
    SPECTRUM_INDEX_LENGTH: 4,
    get SIBLINGS_OFFSET() {
        return this.SPECTRUM_INDEX_OFFSET + this.SPECTRUM_INDEX_LENGTH;
    },
    SIBLINGS_LENGTH: SPECTRUM_DEPTH * crypto.DIGEST_LENGTH,
    
    get LENGTH() {
        return this.SIBLINGS_OFFSET + this.SIBLINGS_LENGTH;
    },
};

export const REQUEST_CONTRACT_IPO = {
    TYPE: 33,
    
    CONTRACT_INDEX_OFFSET: 0,
    CONTRACT_INDEX_LENGTH: 4,

    get LENGTH() {
        return this.CONTRACT_INDEX_OFFSET + this.CONTRACT_INDEX_LENGTH;
    },
};

export const RESPOND_CONTRACT_IPO = {
    TYPE: 34,

    CONTRACT_INDEX_OFFSET: 0,
    CONTRACT_INDEX_LENGTH: REQUEST_CONTRACT_IPO.CONTRACT_INDEX_LENGTH,
    get TICK_OFFSET() {
        return this.CONTRACT_INDEX_OFFSET + this.CONTRACT_INDEX_LENGTH;
    },
    TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,
    get PUBLIC_KEYS_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    NUMBER_OF_PUBLIC_KEYS: NUMBER_OF_COMPUTORS,
    get PUBLIC_KEYS_LENGTH() {
        return this.NUMBER_OF_PUBLIC_KEYS * crypto.PUBLIC_KEY_LENGTH;
    },
    get PRICES_OFFSET() {
        return this.PUBLIC_KEYS_OFFSET + this.PUBLIC_KEYS_LENGTH;
    },
    get PRICES_LENGTH() {
        return this.NUMBER_OF_PUBLIC_KEYS * BROADCAST_TRANSACTION.AMOUNT_LENGTH;
    },

    get LENGTH() {
        return this.PRICES_OFFSET + this.PRICES_LENGTH;
    },
};

export const REQUEST_ISSUED_ASSETS = {
    TYPE: 36,

    PUBLIC_KEY_OFFSET: 0,

    get LENGTH() {
        return this.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
};

export const RESPOND_ISSUED_ASSETS = {
    TYPE: 37,

    ISSUANCE_PUBLIC_KEY_OFFSET: 0,
    TYPE_LENGTH: 1,
    TYPES: {
        EMPTY: 0,
        ISSUANCE: 1,
        OWNERSHIP: 2,
        POSSESSION: 3,
    },
    get ISSUANCE_TYPE_OFFSET() {
        return this.ISSUANCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get NAME_OFFSET() {
        return this.ISSUANCE_TYPE_OFFSET + this.TYPE_LENGTH;
    },
    NAME_LENGTH: 7,
    get NUMBER_OF_DECIMAL_PLACES_OFFSET() {
        return this.NAME_OFFSET + this.NAME_LENGTH;
    },
    NUMBER_OF_DECIMAL_PLACES_LENGTH: 1,

    get UNIT_OF_MEASUREMENT_OFFSET() {
        return this.NUMBER_OF_DECIMAL_PLACES_OFFSET + this.NUMBER_OF_DECIMAL_PLACES_LENGTH;
    },
    UNIT_OF_MEASUREMENT_LENGTH: 7,
    UNITS_OF_MEASURMENT: {
        AMPERE: 0,
        CANDELA: 1,
        KELVIN: 2,
        KILOGRAM: 3,
        METER: 4,
        MOLE: 5,
        SECOND: 6,
    },

    get TICK_OFFSET() {
        return this.UNIT_OF_MEASUREMENT_OFFSET + this.UNIT_OF_MEASUREMENT_LENGTH;
    },
    TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,

    // TODO: Add siblings

    get LENGTH() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
};

export const REQUEST_OWNED_ASSETS = {
    TYPE: 38,

    PUBLIC_KEY_OFFSET: 0,

    get LENGTH() {
        return this.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
};

export const RESPOND_OWNED_ASSETS = {
    ...RESPOND_ISSUED_ASSETS,

    TYPE: 39,

    get OWNERSHIP_PUBLIC_KEY_OFFSET() {
        return this.UNIT_OF_MEASUREMENT_OFFSET + this.UNIT_OF_MEASUREMENT_LENGTH;
    },
    get OWNERSHIP_TYPE_OFFSET() {
        return this.OWNERSHIP_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get OWNERSHIP_MANAGING_CONTRACT_INDEX_OFFSET() {
        return this.OWNERSHIP_TYPE_OFFSET + this.TYPE_LENGTH + 1 // padding;
    },
    MANAGING_CONTRACT_INDEX_LENGTH: 2,
    get ISSUANCE_INDEX_OFFSET() {
        return this.OWNERSHIP_MANAGING_CONTRACT_INDEX_OFFSET + this.MANAGING_CONTRACT_INDEX_LENGTH;
    },
    ISSUANCE_INDEX_LENGTH: REQUEST_CONTRACT_IPO.CONTRACT_INDEX_LENGTH,
    get NUMBER_OF_OWNED_SHARES_OFFSET() {
        return this.ISSUANCE_INDEX_OFFSET + this.ISSUANCE_INDEX_LENGTH;
    },
    NUMBER_OF_SHARES_LENGTH: 8,

    get TICK_OFFSET() {
        return this.NUMBER_OF_OWNED_SHARES_OFFSET + this.NUMBER_OF_SHARES_LENGTH;
    },
    TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,

    // TODO: Add siblings

    get LENGTH() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
};

export const REQUEST_POSSESSED_ASSETS = {
    TYPE: 40,

    PUBLIC_KEY_OFFSET: 0,

    get LENGTH() {
        return this.PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
};


export const RESPOND_POSSESSED_ASSETS = {
    ...RESPOND_OWNED_ASSETS,

    TYPE: 41,

    get POSSESSION_PUBLIC_KEY_OFFSET() {
        return this.NUMBER_OF_OWNED_SHARES_OFFSET + this.NUMBER_OF_SHARES_LENGTH;
    },
    get POSSESSION_TYPE_OFFSET() {
        return this.POSSESSION_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get POSSESSION_MANAGING_CONTRACT_INDEX_OFFSET() {
        return this.POSSESSION_TYPE_OFFSET + this.TYPE_LENGTH + 1 // padding;
    },
    get POSSESSION_INDEX_OFFSET() {
        return this.POSSESSION_MANAGING_CONTRACT_INDEX_OFFSET + this.MANAGING_CONTRACT_INDEX_LENGTH;
    },
    POSSESSION_INDEX_LENGTH: REQUEST_CONTRACT_IPO.CONTRACT_INDEX_LENGTH,
    get NUMBER_OF_POSSESSED_SHARES_OFFSET() {
        return this.ISSUANCE_INDEX_OFFSET + this.ISSUANCE_INDEX_LENGTH;
    },
    NUMBER_OF_SHARES_LENGTH: 8,

    get TICK_OFFSET() {
        return this.NUMBER_OF_POSSESSED_SHARES_OFFSET + this.NUMBER_OF_SHARES_LENGTH;
    },
    TICK_LENGTH: BROADCAST_TICK.TICK_LENGTH,

    // TODO: Add siblings

    get LENGTH() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
};

export const REQUEST_CONTRACT_FUNCTION = {
    TYPE: 42,

    CONTRACT_INDEX_OFFSET: 0,
    CONTRACT_INDEX_LENGTH: REQUEST_CONTRACT_IPO.CONTRACT_INDEX_LENGTH,
    get INPUT_TYPE_OFFSET() {
        return this.CONTRACT_INDEX_OFFSET + this.CONTRACT_INDEX_LENGTH;
    },
    INPUT_TYPE_LENGTH: BROADCAST_TRANSACTION.INPUT_TYPE_LENGTH,
    get INPUT_SIZE_OFFSET() {
        return this.INPUT_TYPE_OFFSET + this.INPUT_TYPE_LENGTH;
    },
    INPUT_SIZE_LENGTH: 2,
    
    // Variable sized input

    get MIN_LENGTH() {
        return this.INPUT_TYPE_OFFSET + this.INPUT_SIZE_LENGTH;
    },

    get MAX_INPUT_SIZE() {
        return REQUEST_RESPONSE_HEADER.MAX_SIZE - this.MIN_LENGTH;
    },

    MAX_LENGTH: REQUEST_RESPONSE_HEADER.MAX_SIZE,
    length(inputSize) {
        if (inputSize > this.MAX_INPUT_SIZE) {
            throw new RangeError('Invalid input size.');
        }
        return this.MIN_LENGTH + inputSize;
    },
};

export const RESPOND_CONTRACT_FUNCTION = {
    TYPE: 43,

    OUTPUT_OFFSET: 0,
    
    // Variable-size output; the size must be 0 if the invocation has failed for whatever reason (e.g. no a function registered for [inputType], or the function has timed out)
};

export const NETWORK_MESSAGES = {
    [EXCHANGE_PUBLIC_PEERS.TYPE]: EXCHANGE_PUBLIC_PEERS,
    [BROADCAST_COMPUTORS.TYPE]: BROADCAST_COMPUTORS,
    [BROADCAST_TICK.TYPE]: BROADCAST_TICK,
    [REQUEST_COMPUTORS.TYPE]: REQUEST_COMPUTORS,
    [REQUEST_QUORUM_TICK.TYPE]: REQUEST_QUORUM_TICK,
    [BROADCAST_TRANSACTION.TYPE]: BROADCAST_TRANSACTION,
    [REQUEST_CURRENT_TICK_INFO.TYPE]: REQUEST_CURRENT_TICK_INFO,
    [RESPOND_CURRENT_TICK_INFO.TYPE]: RESPOND_CURRENT_TICK_INFO,
    [REQUEST_ENTITY.TYPE]: REQUEST_ENTITY,
    [RESPOND_ENTITY.TYPE]: RESPOND_ENTITY,
    [REQUEST_CONTRACT_IPO.TYPE]: REQUEST_CONTRACT_IPO,
    [RESPOND_CONTRACT_IPO.TYPE]: RESPOND_CONTRACT_IPO,
    [REQUEST_ISSUED_ASSETS.TYPE]: REQUEST_ISSUED_ASSETS,
    [RESPOND_ISSUED_ASSETS.TYPE]: RESPOND_ISSUED_ASSETS,
    [REQUEST_OWNED_ASSETS.TYPE]: REQUEST_OWNED_ASSETS,
    [RESPOND_OWNED_ASSETS.TYPE]: RESPOND_OWNED_ASSETS,
    [REQUEST_POSSESSED_ASSETS.TYPE]: REQUEST_POSSESSED_ASSETS,
    [RESPOND_POSSESSED_ASSETS.TYPE]: RESPOND_POSSESSED_ASSETS,
    [REQUEST_CONTRACT_FUNCTION.TYPE]: REQUEST_CONTRACT_FUNCTION,
    [RESPOND_CONTRACT_FUNCTION.TYPE]: RESPOND_CONTRACT_FUNCTION, 
};

const packetSize = function (packet) {
    return (packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET] | packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET + 1] << 8 | packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET + 2] << 16) & 0xFFFFFF;
};

export const createPacket = function (type, contentSize) {
    if (contentSize) {
        const MAX_LENGTH = NETWORK_MESSAGES[type].MAX_LENGTH || NETWORK_MESSAGES[type].LENGTH;
        if (REQUEST_RESPONSE_HEADER.LENGTH + contentSize > MAX_LENGTH) {
            throw new RangeError(`Invalid content size. Expected ${MAX_LENGTH}bytes at most.`);
        }
    }

    const packet = new Uint8Array(contentSize ? REQUEST_RESPONSE_HEADER.LENGTH + contentSize : REQUEST_RESPONSE_HEADER.LENGTH + NETWORK_MESSAGES[type].LENGTH);
    const packetView = new DataView(packet.buffer, packet.byteOffset);
  
    packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET] = packet.byteLength;
    packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET + 1] = packet.byteLength >> 8;
    packet[REQUEST_RESPONSE_HEADER.SIZE_OFFSET + 2] = packet.byteLength >> 16;

    packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] = type;

    return {
        get size() {
            return packet.byteLength;
        },
        get type() {
            return type;
        },
        get dejavu() {
            return packetView.getUint32(REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET, true);
        },
        transmissionBytes: packet,
        randomizeDejavu() {
            packet.set(globalThis.crypto.getRandomValues(new Uint8Array(REQUEST_RESPONSE_HEADER.DEJAVU_LENGTH)), REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET);
            return this.dejavu;
        },
        zeroDejavu() {
            for (let i = 0; i < REQUEST_RESPONSE_HEADER.DEJAVU_LENGTH; i++) {
                packet[REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET + i] = 0;
            }
            return 0;
        },
        setDejavu(dejavu) {
            packetView.setUint32(REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET, dejavu, true);
            return dejavu;
        },
        set(array, offset = 0) {
            packet.set(array.slice(), REQUEST_RESPONSE_HEADER.LENGTH + offset);
        },
        setUint8(offset, value) {
            packet[REQUEST_RESPONSE_HEADER.LENGTH + offset] = value;
        },
        setUint16(offset, value) {
            packetView.setUint16(REQUEST_RESPONSE_HEADER.LENGTH + offset, value, true);
        },
        setUint32(offset, value) {
            packetView.setUint32(REQUEST_RESPONSE_HEADER.LENGTH + offset, value, true);
        },
        setBigUint64(offset, value) {
            packetView.setBigUint64(REQUEST_RESPONSE_HEADER.LENGTH + offset, value, true);
        },
    };
};

export const createTransceiver = function (receiveCallback) {
    const publicPeers = {
        [COMMUNICATION_PROTOCOLS.TCP]: [],
        [COMMUNICATION_PROTOCOLS.WEBSOCKET]: [],
    };
    const peers = {
        [COMMUNICATION_PROTOCOLS.TCP]: [],
        [COMMUNICATION_PROTOCOLS.WEBSOCKET]: [],
    };
    const ignoredPeers = new Set();
    const initialPeers = new Set();
    const initialHandshakingPeers = new Set();
    const initiallyExchangedPeers = [];
    let initialHandshakesDone = false;

    let numberOfPeers = 0;

    const setPublicPeers = function (message, peer) {
        for (let offset = EXCHANGE_PUBLIC_PEERS.EXCHANGED_PEERS_OFFSET; offset < EXCHANGE_PUBLIC_PEERS.EXCHANGED_PEERS_OFFSET + EXCHANGE_PUBLIC_PEERS.EXCHANGED_PEERS_LENGTH; offset += EXCHANGE_PUBLIC_PEERS.ADDRESS_LENGTH) {
            const receivedAddress = message.slice(offset, offset + EXCHANGE_PUBLIC_PEERS.ADDRESS_LENGTH).join('.');

            if (receivedAddress !== '0.0.0.0' && !ignoredPeers.has(receivedAddress) && publicPeers[peer.protocol].indexOf(receivedAddress) === -1 && peers[peer.protocol].findIndex(({ address }) => address === receivedAddress) === -1) {
                if (publicPeers[peer.protocol].length === MAX_NUMBER_OF_PUBLIC_PEERS) {
                    publicPeers[peer.protocol][Math.floor(Math.random() * MAX_NUMBER_OF_PUBLIC_PEERS)] = receivedAddress;
                } else {
                    publicPeers[peer.protocol].push(receivedAddress);
                }
            }
        }
    };

    const _receiveCallback = function (type, packet, message, peer) {
        switch (peer.protocol) {
            case COMMUNICATION_PROTOCOLS.TCP:
                switch (type) {
                    case EXCHANGE_PUBLIC_PEERS.TYPE:
                        if (initialHandshakingPeers.size < MIN_NUMBER_OF_PUBLIC_PEERS && initialPeers.has(peer.address) && !initialHandshakingPeers.has(peer.address)) {
                            initialHandshakingPeers.add(peer.address);

                            if (!initialHandshakesDone) {
                                initiallyExchangedPeers.push({ packet, message, peer });
                            } else {
                                setPublicPeers(message, peer);
                            }
                        }
                        break;
                }
                break;
        }

        if (peer.protocol === COMMUNICATION_PROTOCOLS.WEBSOCKET) {
            receiveCallback(type, packet, message, peer);
        } else {
            if (!initialHandshakesDone) {
                if (type === EXCHANGE_PUBLIC_PEERS.TYPE) {
                    if (initialHandshakingPeers.size === MIN_NUMBER_OF_PUBLIC_PEERS) {
                        if (typeof receiveCallback === 'function') {
                            for (let i = 0; i < initiallyExchangedPeers.length; i++) {
                                receiveCallback(EXCHANGE_PUBLIC_PEERS.TYPE, initiallyExchangedPeers[i].packet, initiallyExchangedPeers[i].message, initiallyExchangedPeers[i].peer);
                                setPublicPeers(initiallyExchangedPeers[i].message, initiallyExchangedPeers[i].peer);
                            }
                        }
                        initialHandshakesDone = true;
                    }
                }
            } else if (typeof receiveCallback === 'function') {
                receiveCallback(type, packet, message, peer);
            }
        }
    };

    const _connect = async function ({ protocol, tls, address, port, rotationPeriod }, peerIndex) {
        let socket;
        let rotationTimeout;
        let shouldReconnect = true;

        const transmit = function (packet) {
            switch (protocol) {
                case COMMUNICATION_PROTOCOLS.TCP:
                    if (socket !== undefined && socket.readyState === 'open') {
                        socket.write(packet);
                    }
                    break;

                case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                    if (socket !== undefined) {
                        socket.send(packet);
                    }
                    break;
            }
        };

        const transmitToOthers = function (packet) {
            for (let anotherProtocol in peers) {
                if (peers.hasOwnProperty(anotherProtocol)) {
                    for (const anotherPeer of peers[anotherProtocol]) {
                        if (anotherPeer.address !== address) {
                            anotherPeer.transmit(packet);
                        }
                    }
                }
            }
        };

        const transmitToAll = function (packet) {
            for (let anotherProtocol in peers) {
                if (peers.hasOwnProperty(anotherProtocol)) {
                    const connectedPeers = peers[protocol].filter(anotherPeer => anotherPeer.readyState() === 'open');

                    for (let i = 0; i < connectedPeers.length; i++) {
                        connectedPeers[i].transmit(typeof packet === 'function' ? packet.call({}, i, connectedPeers.length) : packet);
                    }
                }
            }
        };

        const _disconnect = function (reconnect = false) {
            clearTimeout(rotationTimeout);
            shouldReconnect = reconnect;

            switch (protocol) {
                case COMMUNICATION_PROTOCOLS.TCP:
                    if (socket !== undefined && !socket.destroyed) {
                        socket.destroy();
                    }
                    break;

                case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                    if (socket !== undefined && socket.readyState < 2) {
                        socket.close();
                    }
                    break;
            }
        };

        const connect = function () {
            if ((protocol === COMMUNICATION_PROTOCOLS.TCP && socket.destroyed) || (protocol === COMMUNICATION_PROTOCOLS.WEBSOCKET && socket.readyState > 1)) {
                switch (protocol) {
                    case COMMUNICATION_PROTOCOLS.TCP:
                        if (!ignoredPeers.has(address)) {
                            publicPeers[protocol].push(address);
                        }
                        break;

                    case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                        if (!ignoredPeers.has(new URL(socket.url).hostname)) {
                            publicPeers[protocol].push(address);
                        }
                        break;
                }

                const anotherAddress = publicPeers[protocol].splice(Math.floor(Math.random() * publicPeers[protocol].length), 1)[0];
                const i = peers[protocol].findIndex((peer) => peer.address === address);
                if (peers[protocol][i] !== undefined) {
                    peers[protocol][i].address = anotherAddress;
                }

                setTimeout(function () {
                    _connect({ protocol, tls, port, address: anotherAddress || address, rotationPeriod }, peerIndex);
                }, 1000);
            }
        };

        const _replace = function (forceFlag = false) {
            if (forceFlag || shouldReconnect) {
                _disconnect(true);
                connect();
            }
        };

        const ignore = function () {
            clearTimeout(rotationTimeout);

            switch (protocol) {
                case COMMUNICATION_PROTOCOLS.TCP:
                    ignoredPeers.add(socket.address);
                    socket.destroy();
                    break;

                case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                    ignoredPeers.add(new URL(socket.url).hostname);
                    socket.close();
                    break;
            }
        };

        const remove = function () {
            _disconnect(false);
            const index = peers[protocol].findIndex((peer) => peer.address === address);
            if (index > -1) {
                peers[protocol].splice(index, 1);
            }
        };

        const peer = {
            get protocol() {
                return protocol;
            },
            get index() {
                return peerIndex;
            },
            readyState() {
                switch (protocol) {
                    case COMMUNICATION_PROTOCOLS.TCP:
                        if (socket !== undefined) {
                            return socket.readyState;
                        }
                        break;

                    case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                        if (socket !== undefined) {
                            return socket.readyState === 0 ? 'openning' : (socket.readyState === 1 ? 'open' : 'closed');
                        }
                        break;
                }
            },
            transmit,
            transmitToOthers,
            transmitToAll,
            disconnect() {
                _disconnect();
            },
            replace() {
                _replace(true);
            },
            ignore,
            remove,
        };

        const _peer = {
            address,
            ...peer,
        };

        const _peerIndex = peers[protocol].findIndex((peer) => peer.address === address);
        if (_peerIndex === -1) {
            peers[protocol].push(_peer);
        } else {
            peers[protocol][_peerIndex] = _peer;
        }

        switch (protocol) {
            case COMMUNICATION_PROTOCOLS.TCP:
                const net = await import('node:net');
                socket = new net.Socket();
                socket.connect(port, address, function () {
                    shouldReconnect = true;
                    rotationTimeout = setTimeout(_replace, rotationPeriod);

                    let buffer = new Uint8Array(0);

                    socket.on('data', function (data) {
                        if (buffer.length === 0 && data.byteLength < REQUEST_RESPONSE_HEADER.LENGTH) {
                            return ignore();
                        }

                        const buffer2 = new Uint8Array(buffer.byteLength + data.byteLength);
                        buffer2.set(buffer, 0);
                        buffer2.set(new Uint8Array(data.buffer), buffer.byteLength);
                        buffer = buffer2;
                        let remainingBytes = buffer.byteLength;
                    
                        while (remainingBytes > 0) {
                            const size = packetSize(buffer);
                            if (size <= remainingBytes) {
                                const packet = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + size));
                                _receiveCallback(packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET], packet, packet.subarray(REQUEST_RESPONSE_HEADER.LENGTH, size), _peer);
                                buffer = buffer.slice(size);
                            } else {
                                break;
                            }
                            remainingBytes -= size;
                        }
                    });
                
                    socket.on('close', function () {
                        _replace();
                    });
                });

                socket.on('error', function () {});

                break;

            case COMMUNICATION_PROTOCOLS.WEBSOCKET:
                if (IS_BROWSER) {
                    socket = new WebSocket(`${tls ? 'wss' : 'ws'}://${address}:${port}`);
                    socket.binaryType = 'arraybuffer';

                    socket.addEventListener('open', function () {});

                    socket.addEventListener('message', function (event) {
                        const packet = new Uint8Array(event.data);
                        _peer.dejavu = new DataView(packet.buffer, packet.byteOffset).getUint32(REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET, true);

                        _receiveCallback(packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET], packet, packet.slice(REQUEST_RESPONSE_HEADER.LENGTH), _peer);
                    });

                    socket.addEventListener('close', function () {
                        _replace();
                    });

                    socket.addEventListener('error', function () {});
                }

                break;
        }
    };

    const webSocketServer = IS_BROWSER ? {} : {
        async serve(server, options) {
            const saltBytes = new Uint32Array(2);
            (await import('node:crypto')).getRandomValues(saltBytes);
            const salt = new DataView(saltBytes.buffer, saltBytes.byteOffset).getUint32(saltBytes);

            const dejavu01 = [new BigUint64Array(536870912), new BigUint64Array(536870912)];
            let dejavuSwap = 0;
            let dejavuSwapCounter = DEJAVU_SWAP_LIMIT;

            const port = options?.port || PROXY_PORT;

            const broadcast = function (packet) {
                for (let i = 0; i < peers[COMMUNICATION_PROTOCOLS.TCP].length; i++) {
                    if (peers[COMMUNICATION_PROTOCOLS.TCP][i].readyState() !== 'open') {
                        peers[COMMUNICATION_PROTOCOLS.TCP][i].transmit(packet);
                    }
                }
            };

            const transmitToRandom = function (packet) {
                let peer;
                while (peer?.readyState() !== 'open') {
                    peer = peers[COMMUNICATION_PROTOCOLS.TCP][Math.floor(Math.random() * peers[COMMUNICATION_PROTOCOLS.TCP].length)];
                }
                peer.transmit(packet);
            };

            return server
                .ws(options?.route || '/*', {
                    idleTimeout: options?.idleTimeout || 32,
                    maxBackpressure: options?.maxBackpressure || REQUEST_RESPONSE_HEADER.MAX_SIZE * 451 * 4,
                    maxPayloadLength: REQUEST_RESPONSE_HEADER.MAX_SIZE,

                    open: (socket) => {
                        _receiveCallback(REQUEST_COMPUTORS.TYPE, undefined, new Uint8Array(0), {
                            protocol: COMMUNICATION_PROTOCOLS.WEBSOCKET,
                            dejavu: 1,
                            reply(response) {
                                try {
                                    socket.send(response, true);
                                } catch {}
                            },
                        });
                    },

                    message: async (socket, message, isBinary) => {
                        const packet = new Uint8Array(message);

                        if (isBinary && (
                            packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] === REQUEST_COMPUTORS.TYPE ||
                            packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] === REQUEST_QUORUM_TICK.TYPE ||
                            packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] === BROADCAST_TRANSACTION.TYPE ||
                            packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] === REQUEST_CURRENT_TICK_INFO.TYPE ||
                            packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET] === REQUEST_ENTITY.TYPE
                        )) {
                            const packetView = new DataView(packet.buffer, packet.byteOffset);
                            const dejavu = packetView.getUint32(REQUEST_RESPONSE_HEADER.DEJAVU_OFFSET, true);

                            if (dejavu !== 0) {
                                const input = packet.slice(0, packetView.getUint32(0, true) & 0xFFFFFF);
                                new DataView(input.buffer, input.byteOffset).setUint32(0, salt, true);
                                const saltedIdBytes = new Uint8Array(4);

                                await crypto.K12(input, saltedIdBytes, saltedIdBytes.byteLength);

                                const saltedIdView = new DataView(saltedIdBytes.buffer, saltedIdBytes.byteOffset);
                                const saltedId = saltedIdView.getUint32(0, true);
                                saltedIdView.setUint32(0, saltedId >> 6, true);
                                const index = saltedIdView.getUint32(0, true);

                                const dejavu0View = new DataView(dejavu01[0 ^ dejavuSwap].buffer, dejavu01[0 ^ dejavuSwap].byteOffset);
                                const dejavu1View = new DataView(dejavu01[1 ^ dejavuSwap].buffer, dejavu01[1 ^ dejavuSwap].byteOffset);

                                if (!((dejavu0View.getBigUint64(index, true) | dejavu1View.getBigUint64(index, true)) & BigInt(1n << BigInt(saltedId & 63)))) {
                                    dejavu0View.setBigUint64(index, dejavu0View.getBigUint64(index) | (1n << BigInt(saltedId & 63)), true);
                                    if (!(--dejavuSwapCounter)) {
                                        dejavu01[0 ^ dejavuSwap].fill(0n);
                                        dejavuSwap ^= 1;
                                        dejavuSwapCounter = DEJAVU_SWAP_LIMIT;
                                    }
                                } else {
                                    return;
                                }
                            }

                            _receiveCallback(packet[REQUEST_RESPONSE_HEADER.TYPE_OFFSET], packet, packet.slice(REQUEST_RESPONSE_HEADER.LENGTH), {
                                protocol: COMMUNICATION_PROTOCOLS.WEBSOCKET,
                                dejavu,
                                reply(response) {
                                    try {
                                        socket.send(response, true);
                                    } catch {}
                                },
                                transmitToRandom,
                                broadcast,
                                ignore: socket.close,
                            });
                        } else {
                            socket.close();
                        }
                    },
                })
                .get(options?.route || '/*', (response) => {
                    response.writeStatus('200 OK').end(`qubic-lrv server v${pkg.version}. DO NOT accept data directly from this server! Use a client that verifies records.`);
                })
                .listen(port, (listenSocket) => {
                    if (listenSocket) {
                        console.log(`WebSocket server listening to port ${port}`);
                    }
                });
        }
    };

    return Object.assign(webSocketServer, {
        get numberOfPeers() {
            return numberOfPeers;
        },
        connect(options = []) {
            for (let protocol in peers) {
                if (peers.hasOwnProperty(protocol)) {
                    for (const peer of peers[COMMUNICATION_PROTOCOLS.TCP]) {
                        peer.connect();
                    }
                    for (const peer of peers[COMMUNICATION_PROTOCOLS.WEBSOCKET]) {
                        peer.connect();
                    }
                }
            }

            for (let i = 0; i < options.length; i++) {
                if (typeof options[i] === 'string') {
                    options[i] = {
                        address: options[i],
                    };
                } else if (options[i].address === undefined) {
                    throw new Error('Invalid options, missing address.');
                }
            }

            const uniqueAddresses = new Set();
            for (let i = 0; i < options.length; i++) {
                uniqueAddresses.add(options[i].address);
            }

            if ((peers[0] && peers[0].protocol !== COMMUNICATION_PROTOCOLS.WEBSOCKET) && // TODO: remove after debugging
                (numberOfPeers + uniqueAddresses.size < MIN_NUMBER_OF_PUBLIC_PEERS)
            ) {
                throw new Error('Insuffient number of peers');
            }

            for (let i = 0; i < options.length; i++) {    
                if (options[i].protocol === undefined) {
                    options[i].protocol = COMMUNICATION_PROTOCOLS.DEFAULT;
                } else {
                    let supportsProtocol = false;
                    for (let protocol in COMMUNICATION_PROTOCOLS) {
                        if (COMMUNICATION_PROTOCOLS.hasOwnProperty(protocol)) {
                            if (options[i].protocol === COMMUNICATION_PROTOCOLS[protocol]) {
                                supportsProtocol = true;
                                break;
                            }
                        }
                    }
                    if (!supportsProtocol) {
                        throw new Error(`Unknown protocol ${options[i].protocol}`);
                    }
                }
        
                if (options[i].port === undefined) {
                    options[i].port = options[i].protocol === COMMUNICATION_PROTOCOLS.TCP ? CORE_PORT : PROXY_PORT;
                }

                if (options[i].tls === undefined) {
                    options[i].tls = false;
                }

                if (options[i].rotationPeriod === undefined) {
                    options[i].rotationPeriod = PEER_ROTATION_PERIOD;
                }

                if (initialPeers.size < MIN_NUMBER_OF_PUBLIC_PEERS) {
                    initialPeers.add(options[i].address);
                }

                _connect(options[i], numberOfPeers++);
            }
        },
        disconnect() {
            for (let protocol in peers) {
                if (peers.hasOwnProperty(protocol)) {
                    for (const peer of peers[protocol]) {
                        peer.diconnect();
                    }
                }
            }

        },
        replace() {
            for (let protocol in peers) {
                if (peers.hasOwnProperty(protocol)) {
                    for (const peer of peers[protocol]) {
                        peer.replace();
                    }
                }
            }
        },
        reset(options) {
            initialPeers.clear();
            initialHandshakingPeers.clear();
            initiallyExchangedPeers.length = 0;
            initialHandshakesDone = false;
            for (let protocol in peers) {
                if (peers.hasOwnProperty(protocol)) {
                    publicPeers[protocol] = [];
                    for (const peer of peers[protocol]) {
                        peer.remove();
                    }
                }
            }
            numberOfPeers = 0;
            this.connect(options);
        },
        transmit(packet) {
            for (let protocol in peers) {
                if (peers.hasOwnProperty(protocol)) {
                    publicPeers[protocol] = [];
                    for (const peer of peers[protocol]) {
                        peer.transmit(packet);
                    }
                }
            }
        },
    });
};
