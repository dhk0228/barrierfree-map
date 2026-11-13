/* 로컬 서버: SQLite 이전, 데이터 검증, GeoJSON 병합, 경로와 SSE를 제공한다. */
const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const sqlite3 = require("sqlite3").verbose();
const { DATABASE_NAME, prepareDatabase, resolveDataHome } = require("./data-bootstrap");

const CATEGORIES = new Set([
  "building",
  "ramp",
  "elevator",
  "transport",
  "toilet",
  "obstacle",
  "other",
]);
const VERIFICATION_STATUSES = new Set([
  "not_reviewed",
  "verified",
  "needs_update",
]);
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/foot";
const BACKUP_FILENAME = "배리어프리맵_v3.3_백업.geojson";
const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) =>
      error ? reject(error) : resolve(rows),
    ),
  );
const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))),
  );
const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (error) {
      error
        ? reject(error)
        : resolve({ id: this.lastID, changes: this.changes });
    }),
  );
const parseJson = (value, fallback = {}) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const validLng = (value) =>
  Number.isFinite(value) && value >= -180 && value <= 180;
const normaliseName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
const isoDate = (value) => {
  // SQLite CURRENT_TIMESTAMP의 공백 구분 시각은 UTC다.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value))
    value = value.replace(" ", "T") + "Z";
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};
const nextUpdate = (previous) =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1 || 0)).toISOString();

// v1·v2 데이터도 열 수 있도록 누락된 열만 추가하는 방식으로 이전한다.
async function migrateDatabase(db) {
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, color TEXT, attributes TEXT NOT NULL DEFAULT '{}', lat REAL NOT NULL, lng REAL NOT NULL, verification_status TEXT NOT NULL DEFAULT 'not_reviewed', verified_at TEXT, source_note TEXT NOT NULL DEFAULT '', origin_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS polygons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, paths TEXT NOT NULL, origin_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS import_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, filename TEXT, created_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, error_details TEXT NOT NULL DEFAULT '[]')`,
  );
  const addColumn = async (table, definition) => {
    const name = definition.split(/\s+/)[0],
      columns = await dbAll(db, `PRAGMA table_info(${table})`);
    if (!columns.some((column) => column.name === name))
      await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  await addColumn(
    "nodes",
    "verification_status TEXT NOT NULL DEFAULT 'not_reviewed'",
  );
  await addColumn("nodes", "verified_at TEXT");
  await addColumn("nodes", "source_note TEXT NOT NULL DEFAULT ''");
  await addColumn("nodes", "origin_id TEXT");
  await addColumn("nodes", "created_at TEXT");
  await addColumn("nodes", "updated_at TEXT");
  await addColumn("polygons", "origin_id TEXT");
  await addColumn("polygons", "created_at TEXT");
  await addColumn("polygons", "updated_at TEXT");
  await dbRun(
    db,
    "UPDATE nodes SET created_at=COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP), updated_at=COALESCE(NULLIF(updated_at, ''), CURRENT_TIMESTAMP) WHERE NULLIF(created_at, '') IS NULL OR NULLIF(updated_at, '') IS NULL",
  );
  await dbRun(
    db,
    "UPDATE polygons SET created_at=COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP), updated_at=COALESCE(NULLIF(updated_at, ''), CURRENT_TIMESTAMP) WHERE NULLIF(created_at, '') IS NULL OR NULLIF(updated_at, '') IS NULL",
  );
  await dbRun(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_origin_id ON nodes(origin_id) WHERE origin_id IS NOT NULL",
  );
  await dbRun(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_polygons_origin_id ON polygons(origin_id) WHERE origin_id IS NOT NULL",
  );
  for (const row of await dbAll(
    db,
    "SELECT id FROM nodes WHERE origin_id IS NULL OR origin_id = ''",
  ))
    await dbRun(
      db,
      "UPDATE nodes SET origin_id=?, verification_status=COALESCE(NULLIF(verification_status, ''), 'not_reviewed') WHERE id=?",
      [randomUUID(), row.id],
    );
  for (const row of await dbAll(
    db,
    "SELECT id FROM polygons WHERE origin_id IS NULL OR origin_id = ''",
  ))
    await dbRun(db, "UPDATE polygons SET origin_id=? WHERE id=?", [
      randomUUID(),
      row.id,
    ]);
}
function nodeForClient(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    lat: row.lat,
    lng: row.lng,
    attributes: parseJson(row.attributes),
    verificationStatus: row.verification_status || "not_reviewed",
    verifiedAt: row.verified_at || null,
    sourceNote: row.source_note || "",
    originId: row.origin_id || null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}
function polygonForClient(row) {
  return {
    id: row.id,
    name: row.name,
    paths: parseJson(row.paths, []),
    originId: row.origin_id || null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}
function validateNode(input) {
  const name = String(input.name || "").trim(),
    category = String(input.category || "").trim(),
    lat = Number(input.lat),
    lng = Number(input.lng),
    attributes =
      input.attributes &&
      typeof input.attributes === "object" &&
      !Array.isArray(input.attributes)
        ? input.attributes
        : {};
  if (!name || name.length > 100) return "장소 이름은 1~100자로 입력해주세요.";
  if (!CATEGORIES.has(category)) return "올바르지 않은 장소 카테고리입니다.";
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !validLng(lng))
    return "유효한 위도와 경도를 입력해주세요.";
  if (!VERIFICATION_STATUSES.has(input.verificationStatus || "not_reviewed"))
    return "올바르지 않은 검토 상태입니다.";
  if (input.verifiedAt && !isoDate(input.verifiedAt))
    return "마지막 확인일이 올바르지 않습니다.";
  if (String(input.sourceNote || "").length > 500)
    return "확인 메모는 500자 이하로 입력해주세요.";
  if (
    attributes.image &&
    (!/^https?:\/\//i.test(attributes.image) ||
      String(attributes.image).length > 2048)
  )
    return "사진 URL은 http 또는 https 주소여야 합니다.";
  return null;
}
function validatePolygon(input) {
  const name = String(input.name || "").trim(),
    paths = input.paths;
  if (!name || name.length > 100) return "구역 이름은 1~100자로 입력해주세요.";
  if (!Array.isArray(paths) || paths.length < 3 || paths.length > 500)
    return "위험구역은 3개 이상의 좌표로 구성해야 합니다.";
  if (
    !paths.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        validLng(Number(point[0])) &&
        Number(point[1]) >= -90 &&
        Number(point[1]) <= 90,
    )
  )
    return "위험구역 좌표가 올바르지 않습니다.";
  return null;
}
function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a, b, c) {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}
function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c),
    o2 = orientation(a, b, d),
    o3 = orientation(c, d, a),
    o4 = orientation(c, d, b);
  return (
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d)) ||
    (o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0)
  );
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const a = polygon[index],
      b = polygon[previous];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function routeHitsPolygon(coords, polygon) {
  for (let index = 0; index < coords.length - 1; index++) {
    if (
      pointInPolygon(coords[index], polygon) ||
      pointInPolygon(coords[index + 1], polygon)
    )
      return true;
    for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex++)
      if (
        segmentsIntersect(
          coords[index],
          coords[index + 1],
          polygon[polygonIndex],
          polygon[(polygonIndex + 1) % polygon.length],
        )
      )
        return true;
  }
  return false;
}
function eventHub() {
  const clients = new Set();
  const publish = (type, data) => {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(message);
  };
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": keep-alive\n\n");
  }, 25000);
  heartbeat.unref?.();
  return {
    connect(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\nevent: connected\ndata: {}\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },
    publish,
    close() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
function attributesFromProperties(properties = {}) {
  const attributes =
    properties.attributes &&
    typeof properties.attributes === "object" &&
    !Array.isArray(properties.attributes)
      ? { ...properties.attributes }
      : {};
  for (const key of ["wheelchair", "braille", "toilet", "image"])
    if (properties[key] !== undefined && attributes[key] === undefined)
      attributes[key] = properties[key];
  return attributes;
}
function asNodeFeature(feature) {
  const properties = feature.properties || {},
    coordinates = feature.geometry?.coordinates;
  // GeoJSON 표준 좌표 순서는 [경도, 위도]이므로 Leaflet 화면 순서와 바꿔 읽는다.
  return {
    name: properties.name,
    category: CATEGORIES.has(properties.category)
      ? properties.category
      : "other",
    color: properties.color || "#64748b",
    lat: Number(coordinates?.[1]),
    lng: Number(coordinates?.[0]),
    attributes: attributesFromProperties(properties),
    verificationStatus: VERIFICATION_STATUSES.has(
      properties.verificationStatus || properties.verification_status,
    )
      ? properties.verificationStatus || properties.verification_status
      : "not_reviewed",
    verifiedAt: properties.verifiedAt || properties.verified_at || null,
    sourceNote: properties.sourceNote || properties.source_note || "",
    originId: properties.originId || properties.origin_id || null,
    createdAt: isoDate(properties.createdAt || properties.created_at),
    updatedAt: isoDate(properties.updatedAt || properties.updated_at),
  };
}
function asPolygonFeature(feature) {
  const properties = feature.properties || {},
    ring = feature.geometry?.coordinates?.[0],
    paths = Array.isArray(ring)
      ? ring.map((point) => [Number(point[0]), Number(point[1])])
      : [];
  if (
    paths.length > 1 &&
    paths[0][0] === paths.at(-1)[0] &&
    paths[0][1] === paths.at(-1)[1]
  )
    paths.pop();
  return {
    name: properties.name,
    paths,
    originId: properties.originId || properties.origin_id || null,
    createdAt: isoDate(properties.createdAt || properties.created_at),
    updatedAt: isoDate(properties.updatedAt || properties.updated_at),
  };
}

function importSkipReason(input, existing) {
  // originId가 같은 데이터는 수정 시각이 더 새로울 때만 갱신한다.
  // 시각이 없거나 같으면 현재 로컬 기록을 우선해 실수로 덮어쓰지 않는다.
  if (!input.originId) return "구형 GeoJSON의 동일 항목";
  if (!input.updatedAt) return "병합 기준 시각 없음";
  if (
    !existing.updatedAt ||
    new Date(input.updatedAt) > new Date(existing.updatedAt)
  )
    return null;
  return "현재 로컬 데이터가 같거나 더 최신";
}

// 모든 API 응답은 { data: ... } 형식을 유지해 이전 클라이언트와 호환한다.
function createApp({ dbPath, staticDir = __dirname }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const app = express();
  let db;
  const opened = new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (error) => error ? reject(error) : resolve());
  });
  const ready = opened.then(() => migrateDatabase(db));
  const hub = eventHub();
  const geocodeCache = new Map();
  let lastGeocodeAt = 0,
    geocodeQueue = Promise.resolve();
  let lastChange = null;
  let pendingWrite = Promise.resolve();
  const notify = (action, details) => {
    lastChange = { action, ...details, at: new Date().toISOString() };
    hub.publish("data-changed", lastChange);
  };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  const databaseReady = (handler) => async (req, res, next) => {
    try {
      await ready;
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
  // 병합 중 다른 저장 요청이나 집계·내보내기가 중간 결과를 읽지 않게 한다.
  const afterWrites = (handler) => databaseReady((req, res) => {
    const operation = pendingWrite.then(() => handler(req, res));
    pendingWrite = operation.catch(() => undefined);
    return operation;
  });
  app.get(
    "/api/config",
    databaseReady(async (_req, res) =>
      res.json({
        data: {
          tileUrl: process.env.BFM_TILE_URL || DEFAULT_TILE_URL,
          databasePath: dbPath,
          schemaVersion: 2,
        },
      }),
    ),
  );
  app.get("/api/events", (req, res) => hub.connect(req, res));
  app.get(
    "/api/nodes",
    afterWrites(async (_req, res) =>
      res.json({
        data: (
          await dbAll(
            db,
            "SELECT * FROM nodes ORDER BY julianday(updated_at) DESC, id DESC",
          )
        ).map(nodeForClient),
      }),
    ),
  );
  app.post(
    "/api/nodes",
    afterWrites(async (req, res) => {
      const input = {
          ...req.body,
          verificationStatus: req.body.verificationStatus || "not_reviewed",
        },
        error = validateNode(input);
      if (error) return res.status(400).json({ error });
      const timestamp = nextUpdate();
      const result = await dbRun(
        db,
        "INSERT INTO nodes (name,category,color,attributes,lat,lng,verification_status,verified_at,source_note,origin_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          input.name.trim(),
          input.category,
          input.color || "#64748b",
          JSON.stringify(input.attributes || {}),
          Number(input.lat),
          Number(input.lng),
          input.verificationStatus,
          isoDate(input.verifiedAt),
          String(input.sourceNote || "").trim(),
          input.originId || randomUUID(),
          timestamp,
          timestamp,
        ],
      );
      const saved = nodeForClient(
        await dbGet(db, "SELECT * FROM nodes WHERE id=?", [result.id]),
      );
      notify("node-created", { id: saved.id, name: saved.name });
      res.status(201).json({ data: saved });
    }),
  );
  app.patch(
    "/api/nodes/:id",
    afterWrites(async (req, res) => {
      const id = Number(req.params.id),
        existing = await dbGet(db, "SELECT * FROM nodes WHERE id=?", [id]);
      if (!existing)
        return res.status(404).json({ error: "장소를 찾을 수 없습니다." });
      const old = nodeForClient(existing),
        input = {
          ...old,
          ...req.body,
          attributes: { ...old.attributes, ...(req.body.attributes || {}) },
          verificationStatus:
            req.body.verificationStatus || old.verificationStatus,
          verifiedAt:
            req.body.verifiedAt === undefined ? old.verifiedAt : req.body.verifiedAt,
          sourceNote: req.body.sourceNote ?? old.sourceNote,
        },
        error = validateNode(input);
      if (error) return res.status(400).json({ error });
      await dbRun(
        db,
        "UPDATE nodes SET name=?,category=?,color=?,attributes=?,lat=?,lng=?,verification_status=?,verified_at=?,source_note=?,updated_at=? WHERE id=?",
        [
          input.name.trim(),
          input.category,
          input.color || "#64748b",
          JSON.stringify(input.attributes),
          Number(input.lat),
          Number(input.lng),
          input.verificationStatus,
          isoDate(input.verifiedAt),
          String(input.sourceNote || "").trim(),
          nextUpdate(old.updatedAt),
          id,
        ],
      );
      const saved = nodeForClient(
        await dbGet(db, "SELECT * FROM nodes WHERE id=?", [id]),
      );
      notify("node-updated", { id: saved.id, name: saved.name });
      res.json({ data: saved });
    }),
  );
  app.delete(
    "/api/nodes/:id",
    afterWrites(async (req, res) => {
      const deleted = await dbGet(db, "DELETE FROM nodes WHERE id=? RETURNING id, name", [
        Number(req.params.id),
      ]);
      if (!deleted)
        return res.status(404).json({ error: "장소를 찾을 수 없습니다." });
      notify("node-deleted", deleted);
      res.status(204).end();
    }),
  );
  app.get(
    "/api/polygons",
    afterWrites(async (_req, res) =>
      res.json({
        data: (
          await dbAll(
            db,
            "SELECT * FROM polygons ORDER BY julianday(updated_at) DESC, id DESC",
          )
        ).map(polygonForClient),
      }),
    ),
  );
  app.post(
    "/api/polygons",
    afterWrites(async (req, res) => {
      const error = validatePolygon(req.body);
      if (error) return res.status(400).json({ error });
      const timestamp = nextUpdate();
      const result = await dbRun(
        db,
        "INSERT INTO polygons (name,paths,origin_id,created_at,updated_at) VALUES (?,?,?,?,?)",
        [
          req.body.name.trim(),
          JSON.stringify(req.body.paths),
          req.body.originId || randomUUID(),
          timestamp,
          timestamp,
        ],
      );
      const saved = polygonForClient(
        await dbGet(db, "SELECT * FROM polygons WHERE id=?", [result.id]),
      );
      notify("polygon-created", { id: saved.id, name: saved.name });
      res.status(201).json({ data: saved });
    }),
  );
  app.patch(
    "/api/polygons/:id",
    afterWrites(async (req, res) => {
      const id = Number(req.params.id),
        existing = await dbGet(db, "SELECT * FROM polygons WHERE id=?", [id]);
      if (!existing)
        return res.status(404).json({ error: "구역을 찾을 수 없습니다." });
      const old = polygonForClient(existing),
        input = { ...old, ...req.body },
        error = validatePolygon(input);
      if (error) return res.status(400).json({ error });
      await dbRun(
        db,
        "UPDATE polygons SET name=?,paths=?,updated_at=? WHERE id=?",
        [input.name.trim(), JSON.stringify(input.paths), nextUpdate(old.updatedAt), id],
      );
      const saved = polygonForClient(
        await dbGet(db, "SELECT * FROM polygons WHERE id=?", [id]),
      );
      notify("polygon-updated", { id: saved.id, name: saved.name });
      res.json({ data: saved });
    }),
  );
  app.delete(
    "/api/polygons/:id",
    afterWrites(async (req, res) => {
      const deleted = await dbGet(db, "DELETE FROM polygons WHERE id=? RETURNING id, name", [
        Number(req.params.id),
      ]);
      if (!deleted)
        return res.status(404).json({ error: "구역을 찾을 수 없습니다." });
      notify("polygon-deleted", deleted);
      res.status(204).end();
    }),
  );
  app.get(
    "/api/geocode/search",
    databaseReady(async (req, res) => {
      const query = String(req.query.q || "").trim(),
        key = query.toLowerCase();
      if (!query || query.length > 160)
        return res
          .status(400)
          .json({ error: "검색어는 1~160자로 입력해주세요." });
      const cached = geocodeCache.get(key);
      if (cached?.expiresAt > Date.now())
        return res.json({ data: cached.data, cached: true });
      geocodeQueue = geocodeQueue
        .catch(() => undefined)
        .then(async () => {
          const wait = Math.max(0, 1050 - (Date.now() - lastGeocodeAt));
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
          lastGeocodeAt = Date.now();
          const url = new URL(NOMINATIM_URL);
          url.search = new URLSearchParams({
            format: "jsonv2",
            limit: "5",
            q: query,
            "accept-language": "ko",
          });
          const response = await fetch(url, {
            headers: {
              "User-Agent": "BarrierFreeMap/2.0 (local presentation)",
            },
          });
          if (!response.ok)
            throw new Error("장소 검색 서비스에 연결할 수 없습니다.");
          const data = (await response.json()).map((row) => ({
            displayName: row.display_name,
            lat: Number(row.lat),
            lng: Number(row.lon),
            type: row.type,
          }));
          if (geocodeCache.size >= 100)
            geocodeCache.delete(geocodeCache.keys().next().value);
          geocodeCache.set(key, { data, expiresAt: Date.now() + 3600000 });
          return data;
        });
      try {
        res.json({ data: await geocodeQueue });
      } catch (error) {
        res.status(502).json({ error: error.message });
      }
    }),
  );
  app.post(
    "/api/routes",
    databaseReady(async (req, res) => {
      const { start, end, accessibleMode = true } = req.body || {};
      if (
        !start ||
        !end ||
        !Number.isFinite(Number(start.lat)) ||
        !validLng(Number(start.lng)) ||
        !Number.isFinite(Number(end.lat)) ||
        !validLng(Number(end.lng))
      )
        return res
          .status(400)
          .json({ error: "출발지와 도착지 좌표가 올바르지 않습니다." });
      try {
        const coordinates = `${Number(start.lng)},${Number(start.lat)};${Number(end.lng)},${Number(end.lat)}`,
          response = await fetch(
            `${OSRM_URL}/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=true`,
          ),
          payload = await response.json();
        if (!response.ok || payload.code !== "Ok" || !payload.routes?.length)
          return res
            .status(422)
            .json({ error: "두 지점 사이의 보행 경로를 찾지 못했습니다." });
        const polygons = (await dbAll(db, "SELECT * FROM polygons")).map(
            polygonForClient,
          ),
          candidates = payload.routes
            .map((route) => {
              const hazards = polygons
                .filter((polygon) =>
                  routeHitsPolygon(route.geometry.coordinates, polygon.paths),
                )
                .map((polygon) => ({ id: polygon.id, name: polygon.name }));
              return {
                route,
                hazards,
                score: hazards.length * 1000000 + route.distance,
              };
            })
            .sort((a, b) =>
              accessibleMode
                ? a.score - b.score
                : a.route.distance - b.route.distance,
            ),
          selected = candidates[0],
          nodes = (await dbAll(db, "SELECT * FROM nodes")).map(nodeForClient),
          nearby = nodes.filter(
            (node) =>
              Math.abs(node.lat - Number(start.lat)) < 0.015 ||
              Math.abs(node.lat - Number(end.lat)) < 0.015,
          ),
          wheelchair = nearby.filter(
            (node) => node.attributes.wheelchair,
          ).length;
        res.json({
          data: {
            geometry: selected.route.geometry,
            distance: selected.route.distance,
            duration: selected.route.duration,
            hazards: selected.hazards,
            status: selected.hazards.length
              ? "caution"
              : wheelchair
                ? "good"
                : "unknown",
            alternativesChecked: candidates.length,
            nearbyAccessibility: {
              wheelchair,
              braille: nearby.filter((node) => node.attributes.braille).length,
              toilet: nearby.filter((node) => node.attributes.toilet).length,
            },
          },
        });
      } catch {
        res.status(502).json({
          error:
            "경로 서비스에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.",
        });
      }
    }),
  );
  app.post(
    "/api/import.geojson",
    afterWrites(async (req, res) => {
      const collection = req.body;
      if (
        collection?.type !== "FeatureCollection" ||
        !Array.isArray(collection.features)
      )
        return res.status(400).json({
          error: "GeoJSON FeatureCollection 파일만 가져올 수 있습니다.",
        });
      if (collection.features.length > 5000)
        return res
          .status(400)
          .json({ error: "한 번에 5,000개 이하의 항목만 가져올 수 있습니다." });
      const result = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: [],
        skipDetails: [],
      };
      const pushError = (index, message) => {
        result.errors += 1;
        if (result.errorDetails.length < 20)
          result.errorDetails.push({ index: index + 1, message });
      };
      const pushSkip = (index, message) => {
        result.skipped += 1;
        if (result.skipDetails.length < 20)
          result.skipDetails.push({ index: index + 1, message });
      };
      const existingNodes = (await dbAll(db, "SELECT * FROM nodes")).map(
          nodeForClient,
        ),
        existingPolygons = (await dbAll(db, "SELECT * FROM polygons")).map(
          polygonForClient,
        );
      for (const [index, feature] of collection.features.entries()) {
        try {
          if (feature?.type !== "Feature")
            throw new Error("Feature 형식이 아닙니다.");
          if (feature.geometry?.type === "Point") {
            const input = asNodeFeature(feature),
              error = validateNode(input);
            if (error) throw new Error(error);
            const existing = input.originId
              ? existingNodes.find((node) => node.originId === input.originId)
              : existingNodes.find(
                  (node) =>
                    normaliseName(node.name) === normaliseName(input.name) &&
                    node.category === input.category &&
                    Math.abs(node.lat - input.lat) < 0.000001 &&
                    Math.abs(node.lng - input.lng) < 0.000001,
                );
            if (!existing) {
              const insert = await dbRun(
                db,
                "INSERT INTO nodes (name,category,color,attributes,lat,lng,verification_status,verified_at,source_note,origin_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),COALESCE(?,CURRENT_TIMESTAMP))",
                [
                  input.name.trim(),
                  input.category,
                  input.color,
                  JSON.stringify(input.attributes),
                  input.lat,
                  input.lng,
                  input.verificationStatus,
                  isoDate(input.verifiedAt),
                  String(input.sourceNote).trim(),
                  input.originId || randomUUID(),
                  input.createdAt,
                  input.updatedAt,
                ],
              );
              existingNodes.push(
                nodeForClient(
                  await dbGet(db, "SELECT * FROM nodes WHERE id=?", [
                    insert.id,
                  ]),
                ),
              );
              result.created += 1;
            } else {
              const skipReason = importSkipReason(input, existing);
              if (skipReason) {
                pushSkip(index, skipReason);
                continue;
              }
              await dbRun(
                db,
                "UPDATE nodes SET name=?,category=?,color=?,attributes=?,lat=?,lng=?,verification_status=?,verified_at=?,source_note=?,updated_at=? WHERE id=?",
                [
                  input.name.trim(),
                  input.category,
                  input.color,
                  JSON.stringify(input.attributes),
                  input.lat,
                  input.lng,
                  input.verificationStatus,
                  isoDate(input.verifiedAt),
                  String(input.sourceNote).trim(),
                  input.updatedAt,
                  existing.id,
                ],
              );
              Object.assign(existing, input);
              result.updated += 1;
            }
          } else if (feature.geometry?.type === "Polygon") {
            const input = asPolygonFeature(feature),
              error = validatePolygon(input);
            if (error) throw new Error(error);
            const existing = input.originId
              ? existingPolygons.find(
                  (polygon) => polygon.originId === input.originId,
                )
              : existingPolygons.find(
                  (polygon) =>
                    normaliseName(polygon.name) === normaliseName(input.name) &&
                    JSON.stringify(polygon.paths) ===
                      JSON.stringify(input.paths),
                );
            if (!existing) {
              const insert = await dbRun(
                db,
                "INSERT INTO polygons (name,paths,origin_id,created_at,updated_at) VALUES (?,?,?,COALESCE(?,CURRENT_TIMESTAMP),COALESCE(?,CURRENT_TIMESTAMP))",
                [
                  input.name.trim(),
                  JSON.stringify(input.paths),
                  input.originId || randomUUID(),
                  input.createdAt,
                  input.updatedAt,
                ],
              );
              existingPolygons.push(
                polygonForClient(
                  await dbGet(db, "SELECT * FROM polygons WHERE id=?", [
                    insert.id,
                  ]),
                ),
              );
              result.created += 1;
            } else {
              const skipReason = importSkipReason(input, existing);
              if (skipReason) {
                pushSkip(index, skipReason);
                continue;
              }
              await dbRun(
                db,
                "UPDATE polygons SET name=?,paths=?,updated_at=? WHERE id=?",
                [
                  input.name.trim(),
                  JSON.stringify(input.paths),
                  input.updatedAt,
                  existing.id,
                ],
              );
              Object.assign(existing, input);
              result.updated += 1;
            }
          } else throw new Error("Point 또는 Polygon만 가져올 수 있습니다.");
        } catch (error) {
          pushError(index, error.message);
        }
      }
      await dbRun(
        db,
        "INSERT INTO import_logs (filename,created_count,updated_count,skipped_count,error_details) VALUES (?,?,?,?,?)",
        [
          String(collection.bfm?.filename || "").slice(0, 255),
          result.created,
          result.updated,
          result.skipped,
          JSON.stringify(result.errorDetails),
        ],
      );
      notify("geojson-imported", {
        name: String(collection.bfm?.filename || "").slice(0, 255),
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      });
      res.json({ data: result });
    }),
  );
  app.get(
    "/api/console/summary",
    afterWrites(async (_req, res) => {
      const [nodes, polygons, nodeTotal, polygonTotal, statuses, imports] =
        await Promise.all([
          dbAll(
            db,
            "SELECT * FROM nodes ORDER BY julianday(updated_at) DESC, id DESC LIMIT 8",
          ),
          dbAll(
            db,
            "SELECT * FROM polygons ORDER BY julianday(updated_at) DESC, id DESC LIMIT 8",
          ),
          dbGet(db, "SELECT COUNT(*) AS count FROM nodes"),
          dbGet(db, "SELECT COUNT(*) AS count FROM polygons"),
          dbAll(
            db,
            "SELECT verification_status AS status, COUNT(*) AS count FROM nodes GROUP BY verification_status",
          ),
          dbAll(db, "SELECT * FROM import_logs ORDER BY id DESC LIMIT 5"),
        ]);
      const verificationCounts = {
        not_reviewed: 0,
        verified: 0,
        needs_update: 0,
      };
      for (const row of statuses) verificationCounts[row.status] = row.count;
      res.json({
        data: {
          databasePath: dbPath,
          nodeCount: nodeTotal.count,
          polygonCount: polygonTotal.count,
          verificationCounts,
          recentNodes: nodes.map(nodeForClient),
          recentPolygons: polygons.map(polygonForClient),
          lastChange,
          recentImports: imports.map((row) => ({
            id: row.id,
            importedAt: row.imported_at,
            filename: row.filename,
            created: row.created_count,
            updated: row.updated_count,
            skipped: row.skipped_count,
            errorDetails: parseJson(row.error_details, []),
          })),
        },
      });
    }),
  );
  app.get(
    "/api/export.geojson",
    afterWrites(async (_req, res) => {
      const [nodes, polygons] = await Promise.all([
        dbAll(db, "SELECT * FROM nodes"),
        dbAll(db, "SELECT * FROM polygons"),
      ]);
      const features = [
        ...nodes.map(nodeForClient).map((node) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [node.lng, node.lat] },
          properties: {
            ...node.attributes,
            id: node.id,
            originId: node.originId,
            name: node.name,
            category: node.category,
            color: node.color,
            verificationStatus: node.verificationStatus,
            verifiedAt: node.verifiedAt,
            sourceNote: node.sourceNote,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            attributes: node.attributes,
          },
        })),
        ...polygons.map(polygonForClient).map((polygon) => ({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[...polygon.paths, polygon.paths[0]]],
          },
          properties: {
            id: polygon.id,
            originId: polygon.originId,
            name: polygon.name,
            kind: "hazard",
            createdAt: polygon.createdAt,
            updatedAt: polygon.updatedAt,
          },
        })),
      ];
      res
        .attachment(BACKUP_FILENAME)
        .type("application/geo+json")
        .json({
          type: "FeatureCollection",
          bfm: {
            schemaVersion: 2,
            exportedAt: new Date().toISOString(),
            filename: BACKUP_FILENAME,
          },
          features,
        });
    }),
  );
  app.use(
    "/vendor/leaflet",
    express.static(path.join(staticDir, "node_modules", "leaflet", "dist")),
  );
  app.use("/assets", express.static(path.join(staticDir, "assets")));
  app.get("/control", (_req, res) =>
    res.sendFile(path.join(staticDir, "control.html")),
  );
  app.get(["/", "/barrier_free_map.html"], (_req, res) =>
    res.sendFile(path.join(staticDir, "barrier_free_map.html")),
  );
  app.get(
    ["/control.html", "/control.js", "/control.css", "/app.js", "/style.css",
      "/tokens.css", "/registration.js", "/bfm-api.js"],
    (req, res) => res.sendFile(path.join(staticDir, req.path.slice(1))),
  );
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "GeoJSON 가져오기 요청은 2MB 이하여야 합니다." });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "올바른 JSON 형식이 아닙니다." });
    console.error(error);
    res.status(500).json({ error: "로컬 데이터 처리 중 오류가 발생했습니다." });
  });
  return { app, db, ready, hub, opened };
}
function startServer(options = {}) {
  const { app, db, ready, hub, opened } = createApp({
    dbPath: options.dbPath || path.join(
      resolveDataHome(process.env.APPDATA || require("os").homedir(), process.env.BFM_DATA_HOME),
      "data",
      DATABASE_NAME,
    ),
    staticDir: options.staticDir || __dirname,
  });
  const server = http.createServer(app);
  ready
    .then(() =>
      server.listen(
        options.port ?? process.env.PORT ?? 3000,
        options.host || "127.0.0.1",
        () =>
          console.log(
            `Barrier Free Map server listening on ${server.address().port}`,
          ),
      ),
    )
    .catch((error) => {
      console.error(error);
      process.nextTick(() => server.emit("error", error));
    });
  const close = (callback = () => {}) => {
    hub.close();
    server.close(() => {
      opened.then(() => db.close(callback), () => callback());
    });
  };
  server.on("close", () => hub.close());
  return { server, db, ready, close };
}
if (require.main === module) {
  const appDataPath = process.env.APPDATA || require("os").homedir();
  const override = process.env.BFM_DATA_HOME;
  const start = async () => {
      const { databasePath } = await prepareDatabase({
      dataHome: resolveDataHome(appDataPath, override),
      appDataPath,
      usePrevious: override === undefined,
    });
    const runtime = startServer({ dbPath: databasePath });
    runtime.server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
      runtime.close(() => {});
    });
  };
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { createApp, startServer };
