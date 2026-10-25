// Shared by Metro, the local document and dependency-free Node checks.
const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  fontId: 'literata',
  fontSize: 20,
  lineSpacing: 'comfortable',
  theme: 'paper',
});

const THEMES = Object.freeze({
  paper: Object.freeze({ background: '#F7F3EA', panel: '#FFFCF5', text: '#242723', secondary: '#555D54', accent: '#356356', border: '#D7D5CA',
    highlightAction: '#242723', highlightPrimary: '#6B4D19', highlightSecondary: '#545A54', highlightActionDisabled: '#5D645B', highlightPressed: '#E9E7DF', highlightDanger: '#9A3434' }),
  sepia: Object.freeze({ background: '#EDE1CC', panel: '#F6ECD9', text: '#322A20', secondary: '#665846', accent: '#675136', border: '#CCC0AA',
    highlightAction: '#322A20', highlightPrimary: '#725118', highlightSecondary: '#655646', highlightActionDisabled: '#645744', highlightPressed: '#E4D7BD', highlightDanger: '#8D3030' }),
  night: Object.freeze({ background: '#181C1A', panel: '#242B27', text: '#E8E6DC', secondary: '#B2B9AE', accent: '#9AC6B4', border: '#424C44',
    highlightAction: '#E8E6DC', highlightPrimary: '#D8C490', highlightSecondary: '#B8B2A7', highlightActionDisabled: '#B2B9AE', highlightPressed: '#343D37', highlightDanger: '#E6A4A0' }),
});

const FONTS = Object.freeze({
  literata: Object.freeze({ id: 'literata', label: 'Literata', family: 'Literata' }),
  'source-serif-4': Object.freeze({ id: 'source-serif-4', label: 'Source Serif 4', family: 'Source Serif 4' }),
  'source-sans-3': Object.freeze({ id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3' }),
});

const LINE_SPACING = Object.freeze({ compact: 1.5, comfortable: 1.6, spacious: 1.8 });

module.exports = { DEFAULT_PREFERENCES, THEMES, FONTS, LINE_SPACING };
