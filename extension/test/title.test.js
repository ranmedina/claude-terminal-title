const { test } = require('node:test');
const assert = require('node:assert/strict');
const { truncateTitle, formatLabel, isClaudeCommand, detectClaude, MAX_TITLE } = require('../src/title');

test('truncateTitle trims whitespace', () => {
  assert.equal(truncateTitle('  hello  '), 'hello');
});

test('truncateTitle handles null and undefined', () => {
  assert.equal(truncateTitle(null), '');
  assert.equal(truncateTitle(undefined), '');
});

test('truncateTitle caps long input', () => {
  const long = 'a'.repeat(200);
  assert.equal(truncateTitle(long).length, MAX_TITLE);
});

test('truncateTitle preserves short input', () => {
  assert.equal(truncateTitle('Auth Refactor'), 'Auth Refactor');
});

test('truncateTitle strips control characters', () => {
  assert.equal(truncateTitle('Hello\x00World'), 'HelloWorld');
  assert.equal(truncateTitle('Title\x1b[31mRED'), 'Title[31mRED');
  assert.equal(truncateTitle('a\nb\tc'), 'abc');
  assert.equal(truncateTitle('\x07bell\x7fdel'), 'belldel');
});

test('formatLabel with folder', () => {
  assert.equal(formatLabel('frontend'), 'Claude • frontend');
});

test('formatLabel without folder', () => {
  assert.equal(formatLabel(null), 'Claude');
  assert.equal(formatLabel(''), 'Claude');
  assert.equal(formatLabel(undefined), 'Claude');
});

test('isClaudeCommand matches bare claude', () => {
  assert.ok(isClaudeCommand('claude'));
  assert.ok(isClaudeCommand('claude --help'));
});

test('isClaudeCommand matches absolute path', () => {
  assert.ok(isClaudeCommand('/usr/local/bin/claude --resume'));
});

test('isClaudeCommand matches node-cli invocation', () => {
  assert.ok(isClaudeCommand('node /Users/x/.claude/local/cli.js'));
  assert.ok(isClaudeCommand('node /opt/claude-code/cli.js'));
});

test('isClaudeCommand rejects unrelated commands', () => {
  assert.equal(isClaudeCommand('zsh'), false);
  assert.equal(isClaudeCommand('node server.js'), false);
  assert.equal(isClaudeCommand('claude-monet --paint'), false); // word-boundary check
  assert.equal(isClaudeCommand(''), false);
});

test('isClaudeCommand handles edge cases', () => {
  assert.equal(isClaudeCommand(null), false);
  assert.equal(isClaudeCommand(undefined), false);
});

test('detectClaude returns false for nullish or non-numeric pid', () => {
  assert.equal(detectClaude(0), false);
  assert.equal(detectClaude(null), false);
  assert.equal(detectClaude(undefined), false);
  assert.equal(detectClaude(-1), false);
  assert.equal(detectClaude('abc'), false);
});

test('detectClaude finds claude in immediate process', () => {
  const fakeRun = (cmd, args) => {
    if (cmd === 'ps' && args.join(' ').includes('1234')) return 'claude --resume';
    return '';
  };
  assert.ok(detectClaude(1234, fakeRun));
});

test('detectClaude walks process tree', () => {
  const fakeRun = (cmd, args) => {
    const a = args.join(' ');
    if (cmd === 'ps' && a.includes('100')) return 'zsh';
    if (cmd === 'pgrep' && a.includes('100')) return '200\n';
    if (cmd === 'ps' && a.includes('200')) return 'node /opt/claude-code/cli.js';
    return '';
  };
  assert.ok(detectClaude(100, fakeRun));
});

test('detectClaude returns false when no match in tree', () => {
  const fakeRun = (cmd, args) => {
    const a = args.join(' ');
    if (cmd === 'ps' && a.includes('100')) return 'zsh';
    if (cmd === 'pgrep' && a.includes('100')) return '200\n300';
    if (cmd === 'ps' && a.includes('200')) return 'node server.js';
    if (cmd === 'ps' && a.includes('300')) return 'vim';
    return '';
  };
  assert.equal(detectClaude(100, fakeRun), false);
});

test('detectClaude handles cycles defensively', () => {
  // fake run returns the same child for every parent — would infinite-loop without `seen`
  let calls = 0;
  const fakeRun = (cmd) => {
    calls++;
    if (calls > 50) throw new Error('walked too far — infinite loop?');
    if (cmd === 'ps') return 'zsh';
    if (cmd === 'pgrep') return '100';
    return '';
  };
  // Should terminate even with the cycle
  const result = detectClaude(100, fakeRun);
  assert.equal(result, false);
});

test('detectClaude caps the breadth of the tree walk', () => {
  // fake exec hands back one new pid every call — without a cap this would never end
  let nextPid = 1000;
  const fakeRun = (cmd) => {
    if (cmd === 'ps') return 'zsh';
    if (cmd === 'pgrep') return String(nextPid++);
    return '';
  };
  // Should terminate (cap = 200) and return false
  const result = detectClaude(1, fakeRun);
  assert.equal(result, false);
});

test('detectClaude tolerates exec failures', () => {
  const fakeRun = () => { throw new Error('boom'); };
  assert.equal(detectClaude(123, fakeRun), false);
});
