const { Asset } = require('expo-asset');
const { FONT_ASSETS } = require('./fontAssets');
const { createFontLoader } = require('./fontLoader');

const loadReaderFont = createFontLoader({
  assets: FONT_ASSETS,
  resolveAsset: async assetModule => {
    const asset = Asset.fromModule(assetModule);
    if (!asset.uri) throw new Error('The bundled reader font has no local URI.');
    const url = new URL(asset.uri, window.location.href);
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('The reader font is not a bundled local asset.');
    return url.href;
  },
  readBase64: async uri => {
    const response = await fetch(uri, { credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('The bundled reader font could not be read.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  },
});

module.exports = { loadReaderFont };
