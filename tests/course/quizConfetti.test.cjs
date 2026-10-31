const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function load() {
  const file = path.resolve(__dirname, '../../course/quizConfetti.js');
  assert.ok(fs.existsSync(file), 'the production confetti particle model exists');
  return require(file);
}

function seededRandom(seed = 42) {
  let state = seed;
  return () => {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function interpolate(time, input, output) {
  if (time <= input[0]) return output[0];
  for (let index = 1; index < input.length; index++) {
    if (time <= input[index]) {
      const progress = (time - input[index - 1]) / (input[index] - input[index - 1]);
      return output[index - 1] + (output[index] - output[index - 1]) * progress;
    }
  }
  return output[output.length - 1];
}

function sample(particle, time, viewport) {
  const motion = load().getConfettiMotion(particle, viewport);
  return {
    x: motion.leftPx + interpolate(time, motion.inputRange, motion.translateX),
    y: interpolate(time, motion.inputRange, motion.translateY),
    opacity: interpolate(time, motion.opacityInputRange, motion.opacity),
  };
}

function correlation(first, second) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstMean = mean(first), secondMean = mean(second);
  let covariance = 0, firstVariance = 0, secondVariance = 0;
  first.forEach((value, index) => {
    const firstDelta = value - firstMean, secondDelta = second[index] - secondMean;
    covariance += firstDelta * secondDelta;
    firstVariance += firstDelta * firstDelta;
    secondVariance += secondDelta * secondDelta;
  });
  return covariance / Math.sqrt(firstVariance * secondVariance);
}

test('a celebration has a modest density of compact gold paper pieces', () => {
  const particles = load().createConfettiParticles({ random: seededRandom() });
  assert.ok(particles.length >= 50 && particles.length <= 80);
  for (const particle of particles) {
    assert.ok(particle.width >= 3 && particle.width <= 6);
    assert.ok(particle.height >= 3 && particle.height <= 6);
    assert.ok(Math.max(particle.width, particle.height) / Math.min(particle.width, particle.height) <= 2,
      'paper stays square or a short rectangle instead of a dash');
    assert.ok(['#E5BD68', '#F6E8CD', '#C99B4A'].includes(particle.color));
  }
  assert.ok(new Set(particles.map(particle => particle.color)).size > 1);
});

test('entry times cover the first second across the whole width without a horizontal sweep', () => {
  const particles = load().createConfettiParticles({ random: seededRandom() });
  const columns = Array.from({ length: 4 }, () => []);
  for (const particle of particles) {
    assert.ok(particle.x > 0 && particle.x < 1);
    assert.ok(particle.emissionMs > 0 && particle.emissionMs < 1000);
    columns[Math.floor(particle.x * 4)].push(particle);
  }
  for (const column of columns) {
    assert.ok(column.length >= 12 && column.length <= 20, 'the full width receives balanced paper');
    assert.ok(Math.min(...column.map(particle => particle.emissionMs)) < 250);
    assert.ok(Math.max(...column.map(particle => particle.emissionMs)) > 700);
  }
  assert.ok(Math.abs(correlation(particles.map(particle => particle.x), particles.map(particle => particle.emissionMs))) < 0.3);
  assert.ok(Math.abs(correlation(particles.map(particle => particle.x), particles.map(particle => particle.durationMs))) < 0.3);
});

test('paper starts above the viewport, stays hidden until entry, and finishes below it', () => {
  const { createConfettiParticles, getConfettiMotion, SHOWER_DURATION_MS } = load();
  const particles = createConfettiParticles({ random: seededRandom() });
  for (const viewport of [{ width: 360, height: 780 }, { width: 768, height: 1024 }]) {
    for (const particle of particles) {
      const motion = getConfettiMotion(particle, viewport);
      const endMs = particle.emissionMs + particle.durationMs;
      assert.ok(motion.startY + Math.max(particle.width, particle.height) < 0);
      assert.ok(motion.endY > viewport.height + Math.max(particle.width, particle.height));
      assert.equal(sample(particle, 0, viewport).opacity, 0);
      assert.equal(sample(particle, particle.emissionMs, viewport).opacity, 0);
      assert.equal(sample(particle, endMs, viewport).opacity, 0);
      assert.equal(sample(particle, SHOWER_DURATION_MS, viewport).opacity, 0);
      assert.ok(endMs <= SHOWER_DURATION_MS);
      assert.ok(motion.inputRange.every((value, index, all) => !index || value > all[index - 1]));
      assert.ok(motion.opacityInputRange.every((value, index, all) => !index || value > all[index - 1]));
    }
  }
  assert.ok(SHOWER_DURATION_MS >= 2800 && SHOWER_DURATION_MS <= 3400);
  assert.ok(Math.max(...particles.map(particle => particle.emissionMs + particle.durationMs)) > 2900);
});

test('the shower develops independent vertical trails instead of a descending band', () => {
  const { createConfettiParticles } = load();
  const viewport = { width: 390, height: 844 };
  for (const seed of [1, 42, 2026]) {
    const particles = createConfettiParticles({ random: seededRandom(seed) });
    const start = particles.map(particle => sample(particle, 0, viewport));
    assert.ok(start.every(piece => piece.opacity === 0 && piece.y < 0));
    const early = particles.map(particle => sample(particle, 450, viewport)).filter(piece => piece.opacity > 0 && piece.y >= 0);
    assert.ok(early.length > 5 && early.length < particles.length / 2, 'paper arrives gradually from above');
    for (const time of [1250, 1750]) {
      const visible = particles.map(particle => sample(particle, time, viewport))
        .filter(piece => piece.opacity > 0.1 && piece.y >= 0 && piece.y < viewport.height);
      const ys = visible.map(piece => piece.y);
      assert.ok(visible.length >= 28);
      assert.ok(Math.max(...ys) - Math.min(...ys) > viewport.height * 0.45,
        'independent entry and fall speed spread the shower vertically');
      assert.ok(Math.abs(correlation(visible.map(piece => piece.x), ys)) < 0.4,
        'screen position does not organize paper into a diagonal row');
      for (let column = 0; column < 3; column++) {
        const columnYs = visible.filter(piece => Math.floor(piece.x / viewport.width * 3) === column).map(piece => piece.y);
        assert.ok(columnYs.length >= 4);
        assert.ok(Math.max(...columnYs) - Math.min(...columnYs) > viewport.height * 0.32);
      }
    }
  }
});

test('particle properties are generated once and stay immutable while motion is sampled', () => {
  const { createConfettiParticles, getConfettiMotion } = load();
  const random = seededRandom();
  let calls = 0;
  const particles = createConfettiParticles({ random: () => { calls++; return random(); } });
  const initialCalls = calls;
  assert.ok(initialCalls >= particles.length);
  assert.ok(Object.isFrozen(particles));
  assert.ok(particles.every(Object.isFrozen));
  for (const field of ['emissionMs', 'durationMs', 'driftPx', 'rotationDeg', 'spinDeg']) {
    assert.ok(new Set(particles.map(particle => particle[field])).size > particles.length / 2,
      field + ' varies independently between pieces');
  }
  for (const particle of particles) {
    const viewport = { width: 390, height: 844 };
    const first = getConfettiMotion(particle, viewport);
    assert.deepEqual(getConfettiMotion(particle, viewport), first);
    for (const time of [0, 400, 1250, 2200, 3200]) sample(particle, time, viewport);
  }
  assert.equal(calls, initialCalls, 'rendering the timeline never draws new random properties');
});
