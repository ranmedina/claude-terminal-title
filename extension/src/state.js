// Pure state-machine for "should we apply this title?" — extracted so it can be unit-tested.

function newState() {
  return {
    isClaude: false,
    placeholderApplied: false,
    titled: false,
    lastAppliedTitle: null,
  };
}

/**
 * Decide what to do given the current state and an incoming title.
 * Returns one of: 'skip-noop', 'skip-locked', 'apply-placeholder', 'apply-real', 'apply-override'.
 *
 * @param {ReturnType<typeof newState>} state
 * @param {string|null} desired   — title to apply, or null for placeholder
 * @param {{mode: 'firstOnly'|'always', kind: 'signal'|'placeholder'|'manual'}} ctx
 */
function decide(state, desired, ctx) {
  const want = (desired || '').trim();
  if (ctx.kind === 'placeholder') {
    if (state.titled || state.placeholderApplied) return 'skip-noop';
    return 'apply-placeholder';
  }
  if (ctx.kind === 'manual') {
    return 'apply-override';
  }
  // signal write
  if (!want) return 'skip-noop';
  if (ctx.mode === 'firstOnly' && state.titled) return 'skip-locked';
  if (state.lastAppliedTitle === want) return 'skip-noop';
  return 'apply-real';
}

module.exports = { newState, decide };
