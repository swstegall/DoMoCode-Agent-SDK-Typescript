let lastTimestamp = 0;
let lastRandom = -1n;
const RANDOM_MASK = (1n << 74n) - 1n;
function random74() {
    const bytes = new Uint8Array(10);
    const cryptoObject = globalThis.crypto;
    if (cryptoObject) {
        cryptoObject.getRandomValues(bytes);
    }
    else {
        for (let index = 0; index < bytes.length; index += 1)
            bytes[index] = Math.floor(Math.random() * 256);
    }
    let value = 0n;
    for (const byte of bytes)
        value = (value << 8n) | BigInt(byte);
    return value & RANDOM_MASK;
}
/** Generate a monotonic, RFC 9562 version-7 UUID without a dependency. */
export function uuidv7(now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48)
        throw new RangeError("UUIDv7 timestamp must fit 48 bits");
    let timestamp = now;
    let random = random74();
    if (timestamp < lastTimestamp)
        timestamp = lastTimestamp;
    if (timestamp === lastTimestamp) {
        random = lastRandom + 1n;
        if (random > RANDOM_MASK) {
            timestamp += 1;
            random = random74();
        }
    }
    lastTimestamp = timestamp;
    lastRandom = random;
    const timestampHex = timestamp.toString(16).padStart(12, "0");
    const randomA = (random >> 62n).toString(16).padStart(3, "0");
    const randomB = (random & ((1n << 62n) - 1n)).toString(16).padStart(16, "0");
    const variant = (8 | Number((random >> 60n) & 0x3n)).toString(16);
    return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8)}-7${randomA}-${variant}${randomB.slice(1, 4)}-${randomB.slice(4)}`;
}
export function isUuidv7(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
//# sourceMappingURL=uuid.js.map