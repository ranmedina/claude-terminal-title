const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newState, decide } = require('../src/state');

test('placeholder applied when fresh', () => {
  const s = newState();
  assert.equal(decide(s, null, { kind: 'placeholder', mode: 'firstOnly' }), 'apply-placeholder');
});

test('placeholder skipped when already applied', () => {
  const s = newState();
  s.placeholderApplied = true;
  assert.equal(decide(s, null, { kind: 'placeholder', mode: 'firstOnly' }), 'skip-noop');
});

test('placeholder skipped when terminal already titled', () => {
  const s = newState();
  s.titled = true;
  assert.equal(decide(s, null, { kind: 'placeholder', mode: 'firstOnly' }), 'skip-noop');
});

test('signal applies first real title in firstOnly mode', () => {
  const s = newState();
  s.placeholderApplied = true;
  assert.equal(decide(s, 'Auth Refactor', { kind: 'signal', mode: 'firstOnly' }), 'apply-real');
});

test('firstOnly mode locks after a real title is applied', () => {
  const s = newState();
  s.titled = true;
  assert.equal(decide(s, 'New Title', { kind: 'signal', mode: 'firstOnly' }), 'skip-locked');
});

test('always mode permits subsequent renames', () => {
  const s = newState();
  s.titled = true;
  assert.equal(decide(s, 'New Title', { kind: 'signal', mode: 'always' }), 'apply-real');
});

test('signal skips empty title', () => {
  const s = newState();
  assert.equal(decide(s, '', { kind: 'signal', mode: 'always' }), 'skip-noop');
  assert.equal(decide(s, '   ', { kind: 'signal', mode: 'always' }), 'skip-noop');
});

test('signal skips when title already applied', () => {
  const s = newState();
  s.titled = true;
  s.lastAppliedTitle = 'Foo';
  assert.equal(decide(s, 'Foo', { kind: 'signal', mode: 'always' }), 'skip-noop');
});

test('manual override always applies', () => {
  const s = newState();
  s.titled = true;
  assert.equal(decide(s, 'Anything', { kind: 'manual', mode: 'firstOnly' }), 'apply-override');
});
