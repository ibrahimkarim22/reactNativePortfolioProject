// Literal imports let Metro discover and bundle every face. Loading a family
// reads only its four assets; no network font service participates at runtime.
const FONT_ASSETS = Object.freeze({
  literata: Object.freeze([
    { assetModule: require('../assets/reader-fonts/literata/Literata-Regular.ttf'), weight: 400, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/literata/Literata-Italic.ttf'), weight: 400, style: 'italic' },
    { assetModule: require('../assets/reader-fonts/literata/Literata-Bold.ttf'), weight: 700, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/literata/Literata-BoldItalic.ttf'), weight: 700, style: 'italic' },
  ]),
  'source-serif-4': Object.freeze([
    { assetModule: require('../assets/reader-fonts/source-serif-4/SourceSerif4-Regular.ttf'), weight: 400, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/source-serif-4/SourceSerif4-It.ttf'), weight: 400, style: 'italic' },
    { assetModule: require('../assets/reader-fonts/source-serif-4/SourceSerif4-Bold.ttf'), weight: 700, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/source-serif-4/SourceSerif4-BoldIt.ttf'), weight: 700, style: 'italic' },
  ]),
  'source-sans-3': Object.freeze([
    { assetModule: require('../assets/reader-fonts/source-sans-3/SourceSans3-Regular.ttf'), weight: 400, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/source-sans-3/SourceSans3-It.ttf'), weight: 400, style: 'italic' },
    { assetModule: require('../assets/reader-fonts/source-sans-3/SourceSans3-Bold.ttf'), weight: 700, style: 'normal' },
    { assetModule: require('../assets/reader-fonts/source-sans-3/SourceSans3-BoldIt.ttf'), weight: 700, style: 'italic' },
  ]),
});

module.exports = { FONT_ASSETS };
