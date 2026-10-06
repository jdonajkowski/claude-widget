const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'assets', 'guard');
const IDS = ['climb_out_1', 'climb_out_2', 'pull_1', 'pull_2', 'pull_3', 'stand', 'march_a', 'march_b', 'chew', 'type'];
const LEDGE = ['climb_out_1', 'climb_out_2', 'pull_1', 'pull_2', 'pull_3'];
const manifest = () => JSON.parse(fs.readFileSync(path.join(dir, 'guard-poses.json'), 'utf8'));

test('the manifest lists exactly the ten poses', () => {
  assert.deepEqual(manifest().poses.map((p) => p.id), IDS);
});

test('every pose has its PNG, at the size the manifest says', () => {
  for (const p of manifest().poses) {
    const buf = fs.readFileSync(path.join(dir, p.file));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${p.file} is not a PNG`);
    assert.equal(buf.readUInt32BE(16), p.width, `${p.file} width`);
    assert.equal(buf.readUInt32BE(20), p.height, `${p.file} height`);
  }
});

test('the window edge is the bottom of every image, and only the five climb and pull poses have ledges', () => {
  for (const p of manifest().poses) {
    assert.equal(p.edgeY, p.height, `${p.id} edgeY`);
    assert.equal(p.ledge, LEDGE.includes(p.id), `${p.id} ledge flag`);
    assert.ok(p.scale > 0 && p.scale < 3, `${p.id} scale`);
    assert.ok(['front', 'right'].includes(p.facing), `${p.id} facing`);
  }
});

test('guard-poses.js carries the same data as the JSON (the renderer cannot fetch the JSON)', () => {
  const js = fs.readFileSync(path.join(dir, 'guard-poses.js'), 'utf8');
  assert.ok(js.startsWith('window.GuardPoses = '));
  const data = JSON.parse(js.replace(/^window\.GuardPoses = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(data, manifest());
});
