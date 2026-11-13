const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { DATABASE_NAME, prepareDatabase, resolveDataHome } = require("./data-bootstrap");

const exec = (db, sql) => new Promise((resolve, reject) =>
  db.exec(sql, (error) => error ? reject(error) : resolve()));
const all = (db, sql) => new Promise((resolve, reject) =>
  db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
const close = (db) => new Promise((resolve) => db.close(resolve));

async function verifyBootstrap() {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "bfm-v33-test-"));
  const oldDirectory = path.join(appDataPath, "barrier-free-map-v3.2", "data");
  const oldPath = path.join(oldDirectory, "barrier-free-map-v3.2.sqlite");
  let previous;
  let target;
  try {
    fs.mkdirSync(oldDirectory, { recursive: true });
    previous = new sqlite3.Database(oldPath);
    await exec(previous, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE notes(value TEXT); INSERT INTO notes VALUES ('WAL에서 이전');");
    assert.ok(fs.existsSync(`${oldPath}-wal`));
    const originalBytes = fs.readFileSync(oldPath);

    const options = { appDataPath, dataHome: resolveDataHome(appDataPath), usePrevious: true };
    const first = await prepareDatabase(options);
    assert.equal(first.source, "copied-from-v3.2");
    assert.equal(path.basename(first.databasePath), DATABASE_NAME);
    assert.deepEqual(fs.readFileSync(oldPath), originalBytes);
    target = new sqlite3.Database(first.databasePath);
    assert.deepEqual(await all(target, "SELECT * FROM notes"), [{ value: "WAL에서 이전" }]);

    await exec(target, "INSERT INTO notes VALUES ('3.3에서만 편집');");
    assert.equal((await all(previous, "SELECT * FROM notes")).length, 1);
    assert.equal((await prepareDatabase(options)).source, "existing");

    const verification = await prepareDatabase({
      appDataPath, dataHome: path.join(appDataPath, "verification"),
    });
    assert.equal(verification.source, "empty");
    assert.ok(!fs.existsSync(verification.databasePath));
    assert.throws(() => resolveDataHome(appDataPath, "relative"), /절대 경로/);
  } finally {
    if (target) await close(target);
    if (previous) await close(previous);
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
}

verifyBootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
