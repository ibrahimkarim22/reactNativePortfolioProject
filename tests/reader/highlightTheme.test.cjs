const assert = require('node:assert/strict');
const test = require('node:test');
const { THEMES } = require('../../reader/readerConstants');

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + 0.05) / (values[1] + 0.05); };

test('highlight controls use theme-aware neutrals and restrained accessible destructive tones, including disabled and pressed surfaces', () => {
  const intended = { paper: '#242723', sepia: '#322A20', night: '#E8E6DC' };
  const findings = [];
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.equal(theme.highlightAction, intended[id]);
    for (const token of ['highlightAction', 'highlightActionDisabled', 'highlightDanger', 'highlightPressed']) assert.match(theme[token], /^#[0-9A-F]{6}$/i, `${id}/${token}`);
    const backgrounds = [theme.background, theme.panel, theme.highlightPressed, ...(id === 'night' ? ['#050505', '#10100F'] : [])];
    for (const foreground of ['highlightAction', 'highlightActionDisabled', 'highlightDanger']) for (const background of backgrounds) {
      const ratio = contrast(theme[foreground], background);
      findings.push({ theme: id, foreground, background, ratio });
      assert.ok(ratio >= 4.5, `${id} ${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(findings.length, 33);
});

test('passage and full-quotation actions have distinct theme colors with readable normal and pressed contrast', () => {
  const findings = [];
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const token of ['highlightPrimary', 'highlightSecondary']) assert.match(theme[token], /^#[0-9A-F]{6}$/i, `${id}/${token}`);
    assert.notEqual(theme.highlightPrimary, theme.highlightSecondary, `${id}: passage and quotation actions must differ`);
    const backgrounds = [theme.background, theme.panel, theme.highlightPressed, ...(id === 'night' ? ['#050505', '#10100F'] : [])];
    for (const foreground of ['highlightPrimary', 'highlightSecondary']) for (const background of backgrounds) {
      const ratio = contrast(theme[foreground], background);
      findings.push({ theme: id, foreground, background, ratio });
      assert.ok(ratio >= 4.5, `${id} ${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(findings.length, 22);
});
