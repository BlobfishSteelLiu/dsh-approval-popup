import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const loaded = {};
const sandbox = {
  window: { __ModuleLoader__: { load(entry) { loaded.id = entry.id; loaded.factory = entry.factory; } } },
  console,
  Promise,
  Symbol,
  String,
  Error
};
vm.runInNewContext(code, sandbox, { filename: 'client.js' });
assert.equal(loaded.id, 'dsh-approval-popup');

const React = {
  createElement() { return null; },
  Fragment: {},
  useEffect() {},
  useRef() { return { current: null }; },
  useState(value) { return [value, () => {}]; }
};
const mod = loaded.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require: ${specifier}`);
});

assert.equal(mod.name, 'dsh-approval-popup');
assert.deepEqual([...mod.inject], ['slots', 'locale']);

const dictionaries = {};
const registrations = [];
let effects = 0;
const ctx = {
  effect(fn) { effects += 1; return fn(); },
  locale: {
    register(ns, dict) { dictionaries[ns] = dict; },
    bind() { return (key) => key; },
    resolveText() { return ''; }
  },
  slots: {
    inject(name, fn) {
      assert.ok(['shell.overlay', 'settings.section'].includes(name), name);
      return fn();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    }
  }
};

mod.apply(ctx);
assert.equal(effects, 1);
assert.ok(dictionaries.approvalPopup);
assert.deepEqual(
  Object.keys(dictionaries.approvalPopup.zh).sort(),
  Object.keys(dictionaries.approvalPopup.en).sort(),
  'zh/en dictionaries must stay key-for-key'
);
const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay');
const settings = registrations.find((entry) => entry.options.name === 'settings.section');
assert.equal(overlay.options.id, 'approval-popup');
assert.equal(typeof overlay.component, 'function');
assert.equal(settings.options.id, 'approval-popup');
assert.equal(settings.options.label(), 'settings.title');
assert.equal(typeof settings.component, 'function');

assert.ok(code.includes('/dsh-approval-popup/poll'));
assert.ok(code.includes('/dsh-approval-popup/answer'));
assert.ok(code.includes('/dsh-approval-popup/settings/get'));
assert.ok(code.includes('/dsh-approval-popup/settings/set'));
assert.ok(code.includes('document.visibilityState'));
assert.ok(!code.includes('dsh-client-ui-primitives'), 'must not depend on Harness primitives');
assert.ok(!code.includes('data-modal-autofocus'), 'focus is owned by the plugin');

console.log('client global layer test passed');
