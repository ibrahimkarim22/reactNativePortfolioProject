const SHOWER_DURATION_MS = 3200;
const PAPER_COUNT = 64;
const COLORS = ['#E5BD68', '#F6E8CD', '#C99B4A'];

function createConfettiParticles({ random = Math.random } = {}) {
  // Even coverage with jitter avoids empty sides; shuffling separates position
  // from entry order so the shower never sweeps across the screen in a row.
  const positions = Array.from({ length: PAPER_COUNT }, (_, index) =>
    0.02 + (index + 0.1 + random() * 0.8) / PAPER_COUNT * 0.96);
  for (let index = positions.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [positions[index], positions[swap]] = [positions[swap], positions[index]];
  }

  return Object.freeze(positions.map((x, index) => {
    const emissionMs = 24 + (index + random()) / PAPER_COUNT * 936;
    const durationMs = Math.min(1720 + random() * 520, 3160 - emissionMs);
    return Object.freeze({
      id: index,
      x,
      emissionMs,
      durationMs,
      topOffsetPx: 20 + random() * 100,
      width: 3 + random() * 3,
      height: 3 + random() * 3,
      driftPx: (random() - 0.5) * 88,
      rotationDeg: random() * 360 - 180,
      spinDeg: (random() < 0.5 ? -1 : 1) * (180 + random() * 420),
      color: COLORS[Math.floor(random() * COLORS.length)],
      peakOpacity: 0.72 + random() * 0.24,
    });
  }));
}

function getConfettiMotion(particle, { width, height }) {
  const endMs = particle.emissionMs + particle.durationMs;
  const startY = -particle.topOffsetPx;
  const endY = height + particle.topOffsetPx;
  const startRotation = particle.rotationDeg + 'deg';
  const endRotation = particle.rotationDeg + particle.spinDeg + 'deg';
  return Object.freeze({
    leftPx: particle.x * width - particle.width / 2,
    startY,
    endY,
    inputRange: Object.freeze([0, particle.emissionMs, endMs, SHOWER_DURATION_MS]),
    translateX: Object.freeze([0, 0, particle.driftPx, particle.driftPx]),
    translateY: Object.freeze([startY, startY, endY, endY]),
    rotate: Object.freeze([startRotation, startRotation, endRotation, endRotation]),
    opacityInputRange: Object.freeze([
      0, particle.emissionMs, particle.emissionMs + 75, endMs - 180, endMs, SHOWER_DURATION_MS,
    ]),
    opacity: Object.freeze([0, 0, particle.peakOpacity, particle.peakOpacity, 0, 0]),
  });
}

module.exports = { SHOWER_DURATION_MS, createConfettiParticles, getConfettiMotion };
