// Run with Node 22+: node --experimental-strip-types --test plugins/react-hmr-guard.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HmrContext, ModuleNode } from 'vite';
import { reactHmrGuard } from './react-hmr-guard.ts';

function setup(code: string, file = '/src/Page.tsx') {
  const plugin = reactHmrGuard();
  const transform = plugin.transform as (
    code: string,
    id: string,
    options?: { ssr?: boolean }
  ) => void;
  const update = plugin.handleHotUpdate as (
    context: HmrContext
  ) => Promise<unknown>;
  const module = { id: file } as ModuleNode;
  const sent: unknown[] = [];
  const invalidated: ModuleNode[] = [];
  transform(code, file);

  return {
    plugin,
    transform,
    sent,
    invalidated,
    update: (next: string, modules = [module]) =>
      update({
        file,
        modules,
        timestamp: 123,
        read: async () => next,
        server: {
          moduleGraph: {
            invalidateModule: (module: ModuleNode) => invalidated.push(module),
          },
          ws: { send: (message: unknown) => sent.push(message) },
        },
      } as unknown as HmrContext),
  };
}

const identityChanges = {
  'default function rename': [
    'export default function OldPage() { return <div/> }',
    'export default function NewPage() { return <div/> }',
  ],
  'default class rename': [
    'export default class OldPage extends React.Component { render() { return <div/> } }',
    'export default class NewPage extends React.Component { render() { return <div/> } }',
  ],
  'named class rename': ['export class OldPage {}', 'export class NewPage {}'],
  'aliased component rename': [
    'const OldPage = () => <div/>; export {OldPage as Page};',
    'const NewPage = () => <div/>; export {NewPage as Page};',
  ],
  'function to class': [
    'export default function Page() { return <div/> }',
    'export default class Page extends React.Component { render() { return <div/> } }',
  ],
  'memo wrapper added': [
    'const Page = () => <div/>; export default Page;',
    'const Page = memo(() => <div/>); export default Page;',
  ],
  'memo to forwardRef': [
    'export const Page = memo(() => <div/>);',
    'export const Page = forwardRef(() => <div/>);',
  ],
  'inner HOC component rename': [
    'export const Page = memo(function OldPage() { return <div/> });',
    'export const Page = memo(function NewPage() { return <div/> });',
  ],
  'compound component binding changed': [
    'export const Layout = {Root: First};',
    'export const Layout = {Root: Second};',
  ],
  'default export target changed': [
    'function First() {} function Second() {} export default First;',
    'function First() {} function Second() {} export default Second;',
  ],
};

for (const [name, [before, after]] of Object.entries(identityChanges)) {
  test(`reloads on ${name}`, async () => {
    const state = setup(before);
    assert.deepEqual(await state.update(after), []);
    assert.deepEqual(state.sent, [{ type: 'full-reload', path: '*' }]);
    assert.equal(state.invalidated.length, 1);
  });
}

test('preserves Fast Refresh for body, hook, props and type-only edits', async () => {
  const state = setup(
    'export default function Page() { return <div>old</div> }'
  );
  assert.equal(
    await state.update(
      'export type Props = {label: string}; export default function Page(props: Props) { const [n] = useState(0); return <div>{props.label}{n}</div> }'
    ),
    undefined
  );
  assert.deepEqual(state.sent, []);
});

test('preserves Fast Refresh for class body and HOC body edits', async () => {
  for (const before of [
    'export default class Page extends React.Component { render() { return <div>old</div> } }',
    'export const Page = memo(() => <div>old</div>);',
  ]) {
    const state = setup(before);
    assert.equal(await state.update(before.replace('old', 'new')), undefined);
    assert.deepEqual(state.sent, []);
  }
});

test('ignores formatting, declaration order and export order', async () => {
  const state = setup(
    'const First = () => <div/>; const Second = () => <div/>; export {First, Second};'
  );
  assert.equal(
    await state.update(
      'const Second = () => <span/>;\nconst First=()=> <span/>; export {Second, First};'
    ),
    undefined
  );
});

test('tracks consecutive edits without repeated reloads after a rename', async () => {
  const before = 'export default function OldPage() { return <div>old</div> }';
  const after = before.replace('OldPage', 'NewPage');
  const state = setup(before);
  // An HTTP request can transform the new source before the hot-update hook.
  state.transform(after, '/src/Page.tsx');
  assert.deepEqual(await state.update(after), []);
  assert.equal(await state.update(after.replace('old', 'new')), undefined);
  assert.equal(state.sent.length, 1);
});

test('does not reload for dependencies, styles or unloaded modules', async () => {
  for (const file of ['/node_modules/lib/Page.tsx', '/src/styles.css']) {
    const state = setup('export default function First() {}', file);
    assert.equal(
      await state.update('export default function Second() {}'),
      undefined
    );
  }
  const state = setup('export default function First() {}');
  assert.equal(
    await state.update('export default function Second() {}', []),
    undefined
  );
  assert.deepEqual(state.sent, []);
  assert.equal(state.plugin.apply, 'serve');
});
