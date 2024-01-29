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

export const LE = true;

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export const bytesToBigUint64 = function (bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return view.getBigUint64(0, true);
};

export const bigUint64ToBytes = function (value) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  view.setBigUint64(0, value, true);
  return bytes;
};

export const bigUint64ToString = function (value) {
  let s = '';

  for (let j = 0; j < 14; j++) {
    s += String.fromCharCode(Number(value % 26n + BigInt('A'.charCodeAt(0))));
    value /= 26n;
  }

  return s.toLocaleLowerCase();
};

export const NULL_BIG_UINT64_STRING = bigUint64ToBytes(0n);

export const stringToBigUint64 = function (s) {
  s = s.toUpperCase();

  let value = 0n;

  for (let j = 14; j-- > 0;) {
    value *= 26n + BigInt(s.charCodeAt(j)) - BigInt('A'.charCodeAt(0)); 
  }

  return value;
};

export const bytes32ToString = function (bytes) {
  if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]') {
    throw new TypeError('Invalid bytes. Ecpected Uint8Array.');
  }
  if (bytes.byteLength !== 32) {
    throw new RangeError('Invalid byte length.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let s = '';

  for (let i = 0; i < 4; i++){
    let fragment = view.getBigUint64(i << 3, LE);
    for (let j = 0; j < 14; j++) {
      s += String.fromCharCode(Number(fragment % 26n + BigInt('A'.charCodeAt(0))));
      fragment /= 26n;
    }
  }

  return s.toLowerCase();
};

export const stringToBytes32 = function (s) {
  if (new RegExp(`^[a-z]{${4 * 14}}$`).test(s) === false) {
    throw new Error(`Invalid string. Expected ${4 * 14} lowercase latin chars.`);
  }

  s = s.toUpperCase();

  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer, bytes.byteOffset);

  for (let i = 0; i < 4; i++) {
    view.setBigUint64(i * 8, 0n, LE);
    for (let j = 14; j-- > 0;) {
      view.setBigUint64(i * 8, view.getBigUint64(i * 8, LE) * 26n + BigInt(s.charCodeAt(i * 14 + j)) - BigInt('A'.charCodeAt(0)), LE);
    }
  }

  return bytes;
};

export const bytes64ToString = function (bytes) {
  if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]') {
    throw new TypeError('Invalid bytes. Ecpected Uint8Array.');
  }
  if (bytes.byteLength !== 64) {
    throw new RangeError('Invalid byte length.');
  }

  return bytes32ToString(bytes.subarray(0, 32)) + bytes32ToString(bytes.subarray(32, 64));
}

export const stringToBytes64 = function (s) {
  if (new RegExp(`^[a-z]{${4 * 14 * 2}}$`).test(s) === false) {
    throw new Error(`Invalid string. Expected ${4 * 14 * 2} lowercase latin chars.`);
  }

  const bytes = new Uint8Array(64);
  bytes.set(stringToBytes32(s.slice(0, 4 * 14)), 0);
  bytes.set(stringToBytes32(s.slice(4 * 14, 4 * 14 * 2)), 32);
  return bytes;
}

const checksum = async function (publicKey) {
  const { K12 } = await crypto;
  const buffer = new Uint8Array(4);
  K12(publicKey.slice(), buffer, 4);

  let checksum = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, LE) & 0x3FFFF;
  let s = '';

  for (let i = 0; i < 4; i++) {
    s += String.fromCharCode(checksum % 26 + 'A'.charCodeAt(0));
    checksum /= 26;
  }

  return s;
};

export const bytesToId = async function (bytes) {
  return bytes32ToString(bytes).toUpperCase() + (await checksum(bytes));
};

export const idToBytes = async function (s) {
  if (new RegExp(`^[A-Z]{${60}}$`).test(s) === false) {
    throw new Error('Invalid public key string. Expected 60 uppercase latin chars.');
  }

  const bytes = stringToBytes32(s.slice(0, 56).toLowerCase());

  if ((await checksum(bytes)) !== s.slice(56, 60)) {
    throw new Error('Invalid checksum!');
  }

  return bytes;
};

export const NULL_ID_STRING = 'a'.repeat(60);

export const digestBytesToString = bytes32ToString;

export const stringToDigestBytes = stringToBytes32;

export const NULL_DIGEST_STRING = digestBytesToString(new Uint8Array(32).fill(0));

const HEX_ALPHABET = '0123456789abcdef';
const SHIFTED_HEX_ALPHABET = 'abcdefghijklmnop';

export const shiftedHexToBytes = function (s) {
  if (/[a-p]/.test(s) === false) {
    throw new TypeError('Invalid shifted hex string.');
  }

  if (s.length % 2 !== 0) {
    s = 'a' + s;
  }

  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0, j = 0; j < s.length; j += 2) {
    bytes[i++] = parseInt(s.substr(j, 2).split('').map((char) => HEX_ALPHABET[SHIFTED_HEX_ALPHABET.indexOf(char)]).join(''), 16);
  }
  return bytes;
};

export const bytesToShiftedHex = function (bytes) {
  if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]') {
    throw new TypeError('Invalid bytes. Ecpected Uint8Array.');
  }

  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    s += SHIFTED_HEX_CHARS[bytes[i] >> 4] + SHIFTED_HEX_CHARS[bytes[i] & 15];
  }
  return s;
};

export const stringToSeedBytes = function (s) {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    bytes[i] = ALPHABET.indexOf(s[i]);
  }
  s = undefined;
  return bytes;
}
