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

import crypto from './crypto/index.js';
import { idToBytes, digestBytesToString, bytes64ToString, bytesToId } from './converter.js';
import { MAX_AMOUNT, MAX_NUMBER_OF_CONTRACTS, NUMBER_OF_COMPUTORS } from './constants.js';
import { isZero } from './utils.js';

export const TRANSACTION = {
    SOURCE_PUBLIC_KEY_OFFSET: 0,
    get DESTINATION_PUBLIC_KEY_OFFSET() {
        return this.SOURCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    get AMOUNT_OFFSET() {
        return this.DESTINATION_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH;
    },
    AMOUNT_LENGTH: 8,
    get TICK_OFFSET() {
        return this.AMOUNT_OFFSET + this.AMOUNT_LENGTH;
    },
    TICK_LENGTH: 4,
    
    get INPUT_TYPE_OFFSET() {
        return this.TICK_OFFSET + this.TICK_LENGTH;
    },
    INPUT_TYPE_LENGTH: 2,
    get INPUT_SIZE_OFFSET() {
        return this.INPUT_TYPE_OFFSET + this.INPUT_TYPE_LENGTH;
    },
    INPUT_SIZE_LENGTH: 2,

    get INPUT_OFFSET() {
        return this.INPUT_SIZE_OFFSET + this.INPUT_SIZE_LENGTH;
    },

    MAX_INPUT_SIZE: 1024,

    get MIN_LENGTH() {
        return this.INPUT_OFFSET + crypto.SIGNATURE_LENGTH;
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
    MAX_CONTRACT_IPO_BID_PRICE: MAX_AMOUNT / BigInt(NUMBER_OF_COMPUTORS),
    get CONTRACT_IPO_BID_QUANTITY_OFFSET() {
        return this.CONTRACT_IPO_BID_PRICE_OFFSET + this.CONTRACT_IPO_BID_PRICE_LENGTH;
    },
    CONTRACT_IPO_BID_QUANTITY_LENGTH: 2,
    MAX_CONTRACT_IPO_BID_QUANTITY: NUMBER_OF_COMPUTORS,
    
    get CONTRACT_IPO_BID_LENGTH() {
        return this.CONTRACT_IPO_BID_PRICE_LENGTH + this.CONTRACT_IPO_BID_QUANTITY_LENGTH;
    },
};

export const transactionObject = async function (transaction) {
    if ((MAX_NUMBER_OF_CONTRACTS - 1) > Number.MAX_SAFE_INTEGER) {
        throw new TypeError('Assumed contract index to be safe integer.');
    }

    const { K12, schnorrq } = await crypto;
    const transactionView = new DataView(transaction.buffer, transaction.byteOffset);
    const inputSize = transactionView.getUint16(TRANSACTION.INPUT_SIZE_OFFSET, true);
    const digest = new Uint8Array(crypto.DIGEST_LENGTH);
    const signature = transaction.subarray(TRANSACTION.INPUT_OFFSET + inputSize, TRANSACTION.length(inputSize));

    K12(transaction.subarray(TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET, TRANSACTION.INPUT_OFFSET + inputSize), digest, crypto.DIGEST_LENGTH);

    if (!schnorrq.verify(transaction.subarray(TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET,  TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH), digest, signature)) {
        throw new Error('Invalid transaction signature!');
    }

    const destinationPublicKey = transaction.slice(TRANSACTION.DESTINATION_PUBLIC_KEY_OFFSET, TRANSACTION.DESTINATION_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH);
    const maskedDestinationPublicKey = destinationPublicKey.slice();
    const maskedDestinationPublicKeyView = new DataView(maskedDestinationPublicKey.buffer, maskedDestinationPublicKey.byteOffset);
    maskedDestinationPublicKeyView.setBigUint64(0, maskedDestinationPublicKeyView.getBigUint64(0, true) & ~BigInt(MAX_NUMBER_OF_CONTRACTS - 1), true);
    const destinationPublicKeyView = new DataView(destinationPublicKey.buffer, destinationPublicKey.byteOffset);
    const executedContractIndex = isZero(maskedDestinationPublicKey) ? Number(destinationPublicKeyView.getBigUint64(0, true)) : 0;
    const inputType = transactionView.getUint16(TRANSACTION.INPUT_TYPE_OFFSET, true);

    return Object.freeze({
        sourceId: await bytesToId(transaction.subarray(TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET, TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET + crypto.PUBLIC_KEY_LENGTH)),
        destinationId: await bytesToId(destinationPublicKey),
        amount: transactionView.getBigUint64(TRANSACTION.AMOUNT_OFFSET, true),
        tick: transactionView.getUint32(TRANSACTION.TICK_OFFSET, true),
        inputType,
        inputSize,
        input: Object.freeze(Array.from(transaction.slice(TRANSACTION.INPUT_OFFSET, TRANSACTION.INPUT_OFFSET + inputSize))),
        digest: digestBytesToString(digest),
        signature: bytes64ToString(signature),
        bytes: Object.freeze(Array.from(transaction.subarray(0, TRANSACTION.length(inputSize)))),
        ...((executedContractIndex > 0 && inputType === 0) ? {
            contractIPO_BidPrice: transactionView.getBigUint64(TRANSACTION.CONTRACT_IPO_BID_PRICE_OFFSET, true),
            contractIPO_BidQuantity: transactionView.getUint16(TRANSACTION.CONTRACT_IPO_BID_QUANTITY_OFFSET, true),
            contractIPO_BidAmount: transactionView.getBigUint64(TRANSACTION.CONTRACT_IPO_BID_PRICE_OFFSET, true) * BigInt(transactionView.getUint16(TRANSACTION.CONTRACT_IPO_BID_QUANTITY_OFFSET, true)),
        } : {}),
        executedContractIndex,
    });
};

export const createTransaction = async function (sourcePrivateKey, {
    sourcePublicKey,
    destinationId,
    amount,
    tick,
    inputType,
    input,
    contractIPO_BidPrice,
    contractIPO_BidQuantity,
}) {
    if ((MAX_NUMBER_OF_CONTRACTS - 1) > Number.MAX_SAFE_INTEGER) {
        throw new TypeError('Assumed contract index to be safe integer.');
    }

    let destinationPublicKey;

    if (typeof destinationId === 'string') {
        destinationPublicKey = await idToBytes(destinationId);
    } else {
        throw new TypeError('Invalid destination id!');
    }

    if (typeof amount !== 'bigint' || amount < 0n || amount > MAX_AMOUNT) {
        throw new TypeError('Invalid amount!');
    }

    if (!Number.isInteger(tick) || tick > 0xFFFFFFFF) {
        throw new TypeError('Invalid tick!');
    }

    const transaction = new Uint8Array(TRANSACTION.MAX_LENGTH);
    const transactionView = new DataView(transaction.buffer, transaction.byteOffset);

    let inputSize = 0;

    const maskedDestinationPublicKey = destinationPublicKey.slice();
    const maskedDestinationPublicKeyView = new DataView(maskedDestinationPublicKey.buffer, maskedDestinationPublicKey.byteOffset);
    maskedDestinationPublicKeyView.setBigUint64(0, maskedDestinationPublicKeyView.getBigUint64(0, true) & ~BigInt(MAX_NUMBER_OF_CONTRACTS - 1), true);
    const destinationPublicKeyView = new DataView(destinationPublicKey.buffer, destinationPublicKey.byteOffset);
    const executedContractIndex = isZero(maskedDestinationPublicKey) ? Number(destinationPublicKeyView.getBigUint64(0, true)) : 0;

    if (contractIPO_BidPrice !== undefined || contractIPO_BidQuantity !== undefined) {
        if (!(typeof contractIPO_BidPrice !== 'bigint') || contractIPO_BidPrice <= 0n || contractIPO_BidPrice > TRANSACTION.MAX_CONTRACT_IPO_BID_PRICE) {
            throw new TypeError('Invalid IPO bid price!');
        }
        if (!Number.isInteger(contractIPO_BidQuantity) || contractIPO_BidQuantity <= 0 || contractIPO_BidQuantity > TRANSACTION.MAX_CONTRACT_IPO_BID_QUANTITY) {
            throw new TypeError('Invalid IPO bid quantity!');
        }
        if (executedContractIndex === 0) {
            throw new Error('Invalid IPO destination!');
        }
        if (input !== undefined || inputType !== undefined || inputType !== 0) {
            throw new Error('Expected no transaction input for IPO bid!');
        }

        transactionView.setUint16(TRANSACTION.INPUT_SIZE_OFFSET, (inputSize = TRANSACTION.CONTRACT_IPO_BID_LENGTH), true);

        input = transaction.subarray(TRANSACTION.INPUT_OFFSET, TRANSACTION.INPUT_OFFSET + inputSize);

        transactionView.setBigUint64(TRANSACTION.CONTRACT_IPO_BID_PRICE_OFFSET, contractIPO_BidPrice, true);
        transactionView.setUint16(TRANSACTION.CONTRACT_IPO_BID_QUANTITY_OFFSET, contractIPO_BidQuantity, true);
    } else {
        if (input !== undefined) {
            if (Object.prototype.toString.call(input) !== '[object Uint8Array]') {
                throw new TypeError('Invalid input!')
            }
            if (input.byteLength > TRANSACTION.MAX_INPUT_SIZE) {
                throw new RangeError(`Too long input, must not exceed ${TRANSACTION.MAX_INPUT_SIZE} bytes.`);
            }
        
            transactionView.setUint16(TRANSACTION.INPUT_SIZE_OFFSET, (inputSize = input.byteLength), true);
            transaction.set(input.slice(), TRANSACTION.INPUT_OFFSET);
        }
    }

    if (inputType !== undefined) {
        if (!Number.isInteger(inputType)) {
            throw new TypeError('Invalid inputType.');
        }
        if (inputType > 0xFFFF) {
            throw new TypeError('inputType overflow.');
        }
    
        transactionView.setUint16(TRANSACTION.INPUT_TYPE_OFFSET, inputType, true);
    } else {
        inputType = 0;
    }

    transaction.set(sourcePublicKey, TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET);
    transaction.set(destinationPublicKey, TRANSACTION.DESTINATION_PUBLIC_KEY_OFFSET);
    transactionView.setBigUint64(TRANSACTION.AMOUNT_OFFSET, amount, true);
    transactionView.setUint32(TRANSACTION.TICK_OFFSET, tick, true);
  
    const { K12, schnorrq } = await crypto;
    const digest = new Uint8Array(crypto.DIGEST_LENGTH);
    K12(transaction.subarray(TRANSACTION.SOURCE_PUBLIC_KEY_OFFSET, TRANSACTION.INPUT_OFFSET + inputSize), digest, crypto.DIGEST_LENGTH);

    transaction.set(schnorrq.sign(sourcePrivateKey, sourcePublicKey, digest), TRANSACTION.INPUT_OFFSET + inputSize);

    return transactionObject(transaction);
};
