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

export const isZero = function (array) {
    for (let i = 0; i < array.length; i++) {
        if (array[i] !== 0) {
            return false;
        }
    }
    return true;
};

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
};

export const createLock = function () {
    let locked = false;
    const queue = [];

    return {
        acquire() {
            return new Promise((resolve) => {
                if (!locked) {
                    locked = true;
                    resolve();
                } else {
                    queue.push(resolve)
                }
            })
        },
        release() {
            if (queue.length > 0) {
                queue.shift()();
            } else {
                locked = false;
            }
        },
    };
};

export const IS_BROWSER = (typeof WorkerNavigator === 'function') || ((typeof window !== 'undefined') && (typeof window.document !== 'undefined'));

const idb = function (name) {
    let connection;
    let upgradeNeeded = false;

    return {
        connect(version) {
            return new Promise(function (resolve, reject) {
                const request = indexedDB.open(name, version);
                request.onsuccess = function (event) {
                    connection = event.target.result;
                    resolve();
                };
                request.onupgradeneeded = function (event) {
                    connection = event.target.result;
                    upgradeNeeded = true;
                    resolve();
                };
                request.onerror = function (event) {
                    reject(event);
                };
            });
        },
        create(store) {
            return new Promise(function (resolve, reject) {
                if (!upgradeNeeded) {
                    resolve();
                }
                const objectStore = connection.createObjectStore(store.name, { keyPath: store.keyPath });
                objectStore.transaction.oncomplete = function () {
                    resolve();
                };
                objectStore.transaction.onerror = function (event) {
                    reject(event);
                };
            });
        },
        get(store, key) {
            return new Promise(function (resolve, reject) {
                const transaction = connection.transaction([store]).objectStore(store);
                const request = transaction.get(key);
                request.onsuccess = function (event) {
                    resolve(event.target.result);
                };
                request.onerror = function (event) {
                    reject(event);
                };
            });
        },
        append(store, data) {
            return new Promise(function (resolve, reject) {
                const transaction = connection.transaction([store], 'readwrite').objectStore(store);
                const request = transaction.add(data);
                request.onsuccess = function () {
                    resolve();
                };
                request.onerror = function(event) {
                    reject(event);
                };
            });
        },
        remove(store, key) {
            return new Promise((resolve, reject) => {
                const transaction = connection.transaction([store], 'readwrite').objectStore(store);
                const request = transaction.delete(key);
                request.onsuccess = function () {
                    resolve();
                };
                request.onerror = function (event) {
                    reject(event);
                };
            });
        },
    };
};

export const createStore = async function (store) {
    if (IS_BROWSER) {
        const db = idb('qubic-lrv');

        await db.connect(1);
        await db.create(store);

        return {
            async get(key, tick) {
                const data = await db.get(store.name, tick ? `${key}-${tick}` : key);
                if (data) {
                    return data.value;
                }
            },
            append(key, value) {
                return db.append(store.name, {
                    [store.keyPath]: key,
                    value: value,
                });
            },
            async remove(key, tick) {
                const data = await db.get(store.name, tick ? `${key}-${tick}` : key);
                if (data) {
                    return db.remove(store.name, tick ? `${key}-${tick}` : key);
                }
            },
            async archive(key, tick) {
                const data = await db.get(store.name, key);
                if (data) {
                    await db.append(store.name, {
                        [store.keyPath]: `${key}-${tick}`,
                        value: data.value,
                    });
                    await db.remove(store.name, key);
                    return true;
                } else {
                    return false;
                }
            },
        };
    } else {
        const path = await import('node:path');
        const fs = await import('node:fs');

        const dir = path.join(process.cwd(), store);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }

        return {
            get(key, tick) {
                const file = path.join(dir, key);
                if (tick) {
                    const archive = `${file}-${tick}`;
                    if (fs.existsSync(archive)) {
                        return Uint8Array.from(fs.readFileSync(archive));
                    }
                } else {
                    const temp = `${file}-temp`;
                    if (fs.existsSync(temp)) {
                        fs.unlinkSync(temp);
                    } else {
                        if (fs.existsSync(file)) {
                            return Uint8Array.from(fs.readFileSync(file));
                        }
                    }
                }
            },
            append(key, value) {
                const file = path.join(dir, key);
                const temp = `${file}-temp`;
                fs.writeFileSync(temp, Uint8Array.from(value));
                fs.renameSync(temp, file);
            },
            remove(key, tick) {
                const file = path.join(dir, tick ? `${key}-${tick}` : key);
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            },
            archive(key, tick) {
                const file = path.join(dir, key);
                if (fs.existsSync(file)) {
                    fs.renameSync(file, `${file}-${tick}`);
                    return true;
                } else {
                    return false;
                }
            },
        }
    }
};
