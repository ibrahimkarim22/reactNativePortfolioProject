// Shared by Metro, the local document and dependency-free Node checks.
const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  fontId: 'literata',
  fontSize: 20,
  lineSpacing: 'comfortable',
  theme: 'paper',
});

const THEMES = Object.freeze({
  paper: Object.freeze({ background: '#F7F3EA', panel: '#FFFCF5', text: '#242723', secondary: '#555D54', accent: '#356356', border: '#D7D5CA' }),
  sepia: Object.freeze({ background: '#EDE1CC', panel: '#F6ECD9', text: '#322A20', secondary: '#665846', accent: '#675136', border: '#CCC0AA' }),
  night: Object.freeze({ background: '#181C1A', panel: '#242B27', text: '#E8E6DC', secondary: '#B2B9AE', accent: '#9AC6B4', border: '#424C44' }),
});

const FONTS = Object.freeze({
  literata: Object.freeze({ id: 'literata', label: 'Literata', family: 'Literata' }),
  'source-serif-4': Object.freeze({ id: 'source-serif-4', label: 'Source Serif 4', family: 'Source Serif 4' }),
  'source-sans-3': Object.freeze({ id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3' }),
});

const LINE_SPACING = Object.freeze({ compact: 1.5, comfortable: 1.6, spacious: 1.8 });

module.exports = { DEFAULT_PREFERENCES, THEMES, FONTS, LINE_SPACING };
