import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// Render the real route, catalog, fit card, Expert controls and current-model
// panel. Only their data/IO boundaries are replaced; no host or model is started.
const root = resolve(import.meta.dirname, '..');
const modules = new Map();
let directory;
function stub(file, values) {
  const source = readFileSync(resolve(root, 'src/lib', file), 'utf8');
  const names = new Set([...source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(',')) names.add(item.split(/\s+as\s+/).pop().trim());
  }
  names.delete('');
  return [...names].map(name => `export const ${name}=${values[name] ?? '()=>{throw new Error("Unexpected IO: ' + name + '")}'};`).join('\n');
}
async function load(enabled) {
  if (modules.has(enabled)) return modules.get(enabled);
  mkdirSync(join(root, 'tmp'), { recursive: true });
  directory ??= mkdtempSync(join(root, 'tmp/model-run-routes-'));
  const stubs = {
    native: stub('native.ts', { useNative: '()=>globalThis.__native', nativeState: '()=>globalThis.__native' }),
    store: stub('store.ts', { useStore: 'select=>select(globalThis.__modelStore)', getState: '()=>globalThis.__modelStore', useLifecycle: '()=>({allowed:true})' }),
    client: stub('client.ts', { api: '{get(){throw new Error("Unexpected GET")},post(){throw new Error("Unexpected POST")}}' }),
    'local-model': stub('local-model.ts', { localModelEnabled: String(enabled), useLocalModel: '()=>globalThis.__currentModel' }),
  };
  const output = join(directory, `${enabled}.cjs`);
  await build({
    stdin: { contents: `export {ModelRunScreen} from './src/screens/ModelRun'; export {Seg} from './src/components/ui';
      export {forgetKept} from './src/lib/kept-state';
      export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: root, loader: 'tsx' },
    bundle: true, format: 'cjs', platform: 'node', outfile: output, jsx: 'automatic', logLevel: 'silent',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'read-only-model-data', setup(builder) {
      builder.onResolve({ filter: /\/lib\/(native|store|client|local-model)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const module = createRequire(import.meta.url)(output);
  modules.set(enabled, module);
  return module;
}
test.after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function fixtures({ expert = false, loaded = false, ram = 64, failedModel = '' } = {}) {
  const size = (id, model, experts) => ({ id, model, about: '', download_gb: 42, ram_needed_gb: experts + 1,
    experts_gb: experts, on_this_pc: 'fits', installed: true });
  globalThis.__native = {
    available: true, repo: '', summary: '', error: null,
    jobs: failedModel ? [{ id: 'retained-failure', kind: 'install', state: 'error', model: failedModel,
      family: 'qwen', error: 'Retained Failure For One Model' }] : [],
    instances: [], defaultId: null, fields: [], capabilities: {},
    hardware: { ram_gb: ram, gpus: [{ index: 0, name: 'Fixture GPU', vram_gb: 16, usable: true }] },
    installed: { models: [{ model: 'swift-iq2_xs', config: 'swift.json', model_name: 'Swift', ready: true, context: 32768 }], data_folder: '/Models', engine: { version: '0.1.45.3' } },
    catalog: { families: [
      { family: 'swift', title: 'Swift', about: '', experimental: false, images: false, sizes: [size('swift-iq2_xs', 'IQ2_XS', 32), size('swift-iq3_xxs', 'IQ3_XXS', 44)] },
      { family: 'qwen', title: 'Qwen3.8-Flash-Next', about: '', experimental: false, images: false, sizes: [size('iq3_s', 'IQ3_S', 48)] },
    ], contexts: [32768, 65536, 131072, 262144], recommendation: { family: 'swift', model: 'IQ2_XS', context: 32768 }, context_note: '' },
  };
  globalThis.__modelStore = { setup: { choices: { onboarding: { manual: expert } } }, hardware: null, imageModels: null };
  globalThis.__currentModel = {
    available: true, model: { id: 'shared-physical-model', name: 'Shared Qwen', variant: 'IQ3_XXS', loaded, loading: false, apiBaseUrl: 'http://127.0.0.1:8080/v1' },
    context: { choices: [65536, 131072, 262144], selected: 262144, effective: 262144, phase: 'ready', activeRequests: 0 },
    autoUnload: { choices: [300, 600, 1800], selected: 1800, effective: 1800 },
    codexSync: { state: 'synced', context: 262144 },
  };
  globalThis.window = { location: { hash: '#/models' }, matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: { dataset: {} } };
}
async function render(hash = '#/models', enabled = true, options = {}) {
  const module = await load(enabled);
  module.forgetKept(); fixtures(options); window.location.hash = hash;
  return module.renderToStaticMarkup(module.createElement(module.ModelRunScreen));
}

test('the unified Models default renders the real catalog, fit suggestions and native actions', async () => {
  const html = await render();
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Model Catalog<\/button>/);
  assert.match(html, /role="tab"[^>]*aria-selected="false"[^>]*>Current Model<\/button>/);
  assert.match(html, /aria-labelledby="model-run-panel-tab-catalog"/);
  assert.match(html, /Swift IQ2_XS/);
  assert.match(html, /Fixture GPU/);
  assert.match(html, /Fits fully in memory/);
  assert.match(html, /Model version/);
  assert.match(html, /Expert mode/);
  assert.match(html, /Manage models/);
  assert.match(html, /Load model/);
  assert.match(html, /Other local models/);
  assert.match(html, /Catalog Models Load Separately From Current Model/);
  assert.doesNotMatch(html, /id="local-context-title"/);
});

test('hardware fit is calculated from the reported computer rather than a decorative recommendation', async () => {
  const html = await render('#/models', true, { ram: 16 });
  assert.match(html, /will be read from the SSD/);
  assert.doesNotMatch(html, /Fits fully in memory/);
});

test('retained install failures belong only to their model, not every catalog selection', async () => {
  const unrelated = await render('#/models', true, { failedModel: 'iq3_s' });
  assert.doesNotMatch(unrelated, /Retained Failure For One Model/);
  const selected = await render('#/models', true, { failedModel: 'swift-iq2_xs' });
  assert.match(selected, /Retained Failure For One Model/);
});

test('catalog Expert mode retains configuration, resource and model-file controls', async () => {
  const html = await render('#/models', true, { expert: true });
  assert.match(html, /id="native-expert-settings"/);
  assert.match(html, /Run multiple models/);
  assert.match(html, /Native KV format/);
  assert.match(html, /Native low RAM mode/);
  assert.match(html, /Leave 20% for my work/);
  assert.match(html, /Full performance/);
  assert.match(html, /Model files/);
});

for (const hash of ['#/models/catalog', '#/models?variant=swift-iq3_xxs', '#/tuning', '#/tuning?variant=iq3_s']) {
  test(`existing catalog/config navigation stays accessible at ${hash}`, async () => {
    const html = await render(hash);
    assert.match(html, /aria-labelledby="model-run-panel-tab-catalog"/);
    assert.match(html, /Model version/);
  });
}
for (const hash of ['#/models/local', '#/models/local-import']) {
  test(`native GGUF import remains accessible at ${hash}`, async () => {
    const html = await render(hash);
    assert.match(html, /aria-labelledby="model-run-panel-tab-catalog"/);
    assert.match(html, /Folder with the GGUF files/);
    assert.match(html, /Check files/);
    assert.doesNotMatch(html, /id="local-context-title"/);
  });
}

test('Current Model retains the shared carrier context, idle, connection and preload controls', async () => {
  const html = await render('#/models/current');
  assert.match(html, /aria-labelledby="model-run-panel-tab-current"/);
  for (const label of ['Shared Qwen', 'Context Length', '64K', '128K', '256K', 'Auto Unload', '5 Minutes', '10 Minutes', '30 Minutes', 'Use In Chat', 'Preload Model']) assert.ok(html.includes(label), label);
  assert.match(html, /http:\/\/127\.0\.0\.1:8080\/v1/);
  assert.doesNotMatch(html, /native-model-layout/);
  const loaded = await render('#/models/current', true, { loaded: true });
  assert.match(loaded, /Unload Model/);
});

test('without unified carrier mode the original default and import paths have no added tabs', async () => {
  const html = await render('#/models', false);
  assert.match(html, /Model version/);
  assert.doesNotMatch(html, /model-run-panel|Current Model/);
  assert.match(await render('#/models/local-import', false), /Folder with the GGUF files/);
});

test('the reused app tabs support arrow, Home and End navigation with roving focus', async () => {
  const module = await load(true);
  const choices = [{ value: 'catalog', label: 'Model Catalog' }, { value: 'current', label: 'Current Model' }];
  let selected;
  const tree = module.Seg({ value: 'catalog', options: choices, panelId: 'model-run-panel', onChange: value => { selected = value; } });
  const buttons = tree.props.children;
  let focused = -1;
  const children = choices.map((_, index) => ({ focus() { focused = index; } }));
  for (const [key, expected] of [['ArrowRight', 1], ['ArrowLeft', 1], ['End', 1], ['Home', 0]]) {
    let prevented = false;
    buttons[0].props.onKeyDown({ key, preventDefault() { prevented = true; }, currentTarget: { parentElement: { children } } });
    assert.equal(prevented, true); assert.equal(selected, choices[expected].value); assert.equal(focused, expected);
  }
  assert.equal(buttons[0].props.tabIndex, 0);
  assert.equal(buttons[1].props.tabIndex, -1);
});
