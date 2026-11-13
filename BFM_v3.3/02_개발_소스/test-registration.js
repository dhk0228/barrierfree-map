const assert = require('node:assert/strict');
const { createSubmissionGate } = require('./registration');

(async () => {
  const gate = createSubmissionGate();
  let release, writes = 0;
  const deferred = new Promise(resolve => { release = resolve; });
  const first = gate.run(async () => { writes++; await deferred; });
  assert.equal(gate.pending, true);
  assert.equal(await gate.run(async () => { writes++; }), false);
  assert.equal(writes, 1, 'Repeated clicks must not issue a second write');
  release();
  assert.equal(await first, true);
  assert.equal(gate.pending, false);
  assert.equal(await gate.run(async () => { writes++; }), true);
  assert.equal(writes, 2, 'A later independent registration must be allowed');
  await assert.rejects(gate.run(async () => { throw new Error('network failed'); }), /network failed/);
  assert.equal(gate.pending, false, 'A failed save must not permanently lock the form');
  assert.equal(await gate.run(async () => { writes++; }), true);
  assert.equal(writes, 3, 'Retry must be possible after failure');
  console.log('BFM registration: concurrent-submit exclusion, independent saves and failed-save retry passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
