const { Asset } = require('expo-asset');
const FileSystem = require('expo-file-system');
const { FONT_ASSETS } = require('./fontAssets');
const { createFontLoader } = require('./fontLoader');

const loadReaderFont = createFontLoader({
  assets: FONT_ASSETS,
  resolveAsset: async assetModule => {
    const asset = Asset.fromModule(assetModule);
    await asset.downloadAsync();
    return asset.localUri;
  },
  readBase64: uri => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
});

module.exports = { loadReaderFont };
