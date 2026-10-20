const MAX_FACE_BASE64_LENGTH = 2 * 1024 * 1024;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function validBase64(data) {
  if (typeof data !== 'string' || !data.length || data.length > MAX_FACE_BASE64_LENGTH
      || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  // Reject nonzero unused padding bits, rather than accepting ambiguous data.
  if (data.endsWith('==')) return BASE64_ALPHABET.indexOf(data[data.length - 3]) % 16 === 0;
  if (data.endsWith('=')) return BASE64_ALPHABET.indexOf(data[data.length - 2]) % 4 === 0;
  return true;
}

// Asset acquisition and file reading stay outside this module so its timeout,
// cache and failure behavior can be exercised without a native runtime.
function createFontLoader({ assets, resolveAsset, readBase64, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const cache = new Map();

  return function loadReaderFont(fontId) {
    if (typeof fontId !== 'string' || !Object.prototype.hasOwnProperty.call(assets, fontId)) {
      return Promise.reject(new Error('Unknown reader font.'));
    }
    if (cache.has(fontId)) return cache.get(fontId);

    let timer;
    const work = new Promise((resolve, reject) => {
      timer = setTimeoutFn(() => reject(new Error('Reader font loading timed out after five seconds.')), 5000);
      Promise.all(assets[fontId].map(async face => {
        const uri = await resolveAsset(face.assetModule);
        if (typeof uri !== 'string' || !uri.trim()) throw new Error('The downloaded reader font has no local URI.');
        const data = await readBase64(uri);
        if (!validBase64(data)) throw new Error('The reader font contains invalid base64 data.');
        return Object.freeze({ weight: face.weight, style: face.style, data });
      })).then(faces => resolve(Object.freeze({ fontId, faces: Object.freeze(faces) })), reject);
    });
    const promise = work.then(result => {
      clearTimeoutFn(timer);
      return result;
    }, error => {
      clearTimeoutFn(timer);
      if (cache.get(fontId) === promise) cache.delete(fontId);
      throw error;
    });
    cache.set(fontId, promise);
    return promise;
  };
}

module.exports = { createFontLoader };
