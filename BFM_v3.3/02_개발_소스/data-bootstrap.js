const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { randomUUID } = require("crypto");

const RUNTIME_NAME = "barrier-free-map-v3.3";
const DATABASE_NAME = `${RUNTIME_NAME}.sqlite`;

function resolveDataHome(appDataPath, override) {
  if (override !== undefined && !path.isAbsolute(override))
    throw new Error("BFM_DATA_HOME에 절대 경로를 지정해 주세요.");
  return override ? path.resolve(override) : path.join(appDataPath, RUNTIME_NAME);
}

// SQLite의 읽기 전용 스냅샷에는 커밋된 WAL 데이터도 포함된다.
async function prepareDatabase({ dataHome, appDataPath, usePrevious = false }) {
  const directory = path.join(dataHome, "data");
  const databasePath = path.join(directory, DATABASE_NAME);
  if (fs.existsSync(databasePath)) return { databasePath, source: "existing" };

  const previous = usePrevious && ["3.2", "3.1"].find((version) => {
    const name = `barrier-free-map-v${version}`;
    return fs.existsSync(path.join(appDataPath, name, "data", `${name}.sqlite`));
  });
  // 초기 스키마는 서버가 만든다. 지정한 검증 폴더에서는 이전 버전을 조회하지 않는다.
  if (!previous) return { databasePath, source: "empty" };

  const name = `barrier-free-map-v${previous}`;
  const sourcePath = path.join(appDataPath, name, "data", `${name}.sqlite`);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `transfer-${randomUUID()}.sqlite`);
  try {
    await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY, (error) => {
        if (error) return reject(error);
        db.configure("busyTimeout", 5000);
        db.exec(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`, (copyError) => {
          db.close((closeError) => {
            if (copyError || closeError) reject(copyError || closeError);
            else resolve();
          });
        });
      });
    });
    fs.renameSync(temporary, databasePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { databasePath, source: `copied-from-v${previous}` };
}

module.exports = { DATABASE_NAME, resolveDataHome, prepareDatabase };
