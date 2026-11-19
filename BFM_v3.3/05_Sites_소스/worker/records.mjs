import {
  asNodeFeature, asPolygonFeature, importSkipReason, isoDate,
  nextUpdate, normaliseName, validateNode, validatePolygon,
} from "./domain.mjs";

export const BACKUP_NAME = "배리어프리맵_v3.3_Sites_백업.geojson";
export const REVISION_SQL = "SELECT revision, change FROM activity WHERE id=1";
const RECENT_SQL = "SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC, id DESC";
const ALL_SQL = "SELECT * FROM records ORDER BY id";
const UPSERT_SQL = `INSERT INTO records (kind, origin_id, updated_at, payload)
  SELECT json_extract(value, '$.kind'), json_extract(value, '$.originId'),
    json_extract(value, '$.updatedAt'), json_extract(value, '$.payload') FROM json_each(?)
  WHERE true
  ON CONFLICT (kind, origin_id) DO UPDATE SET updated_at=excluded.updated_at,
    payload=excluded.payload WHERE excluded.updated_at > records.updated_at`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function record(row) {
  return {
    ...JSON.parse(row.payload),
    id: row.id,
    originId: row.origin_id,
    updatedAt: row.updated_at,
  };
}

function makePayload(kind, input, createdAt) {
  const validate = kind === "node" ? validateNode : validatePolygon;
  if (typeof input?.name !== "string") throw new ApiError(400, "이름을 입력해 주세요.");
  if (kind === "node" && (input.lat == null || input.lng == null || input.lat === "" || input.lng === "")) {
    throw new ApiError(400, "위도와 경도를 입력해 주세요.");
  }
  const message = validate(input);
  if (message) throw new ApiError(400, message);
  const base = { name: input.name.trim(), createdAt };
  if (kind === "polygon") return { ...base, paths: input.paths.map((point) => point.map(Number)) };
  const attributes = input.attributes;
  return {
    ...base,
    category: input.category,
    color: typeof input.color === "string" ? input.color : "#64748b",
    lat: Number(input.lat),
    lng: Number(input.lng),
    attributes: attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {},
    verificationStatus: input.verificationStatus || "not_reviewed",
    verifiedAt: isoDate(input.verifiedAt),
    sourceNote: String(input.sourceNote || "").trim(),
  };
}

function originId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 200) {
    throw new ApiError(400, "원본 ID 형식이 올바르지 않습니다.");
  }
  return value;
}

export async function list(db, kind) {
  const { results } = await db.prepare(RECENT_SQL).bind(kind).all();
  return results.map(record);
}

export async function create(db, kind, input) {
  const timestamp = nextUpdate();
  const payload = makePayload(kind, input, timestamp);
  const row = await db.prepare(
    "INSERT INTO records (kind,origin_id,updated_at,payload) VALUES (?,?,?,?) ON CONFLICT (kind,origin_id) DO NOTHING RETURNING *",
  ).bind(kind, originId(input.originId) || crypto.randomUUID(), timestamp, JSON.stringify(payload)).first();
  if (!row) throw new ApiError(409, "이미 같은 원본 ID의 항목이 있습니다.");
  return record(row);
}

export async function update(db, kind, id, input) {
  const existing = await db.prepare("SELECT * FROM records WHERE kind=? AND id=?").bind(kind, id).first();
  if (!existing) throw new ApiError(404, "등록 항목을 찾을 수 없습니다.");
  const old = record(existing);
  const merged = { ...old, ...input };
  if (kind === "node") merged.attributes = { ...old.attributes, ...input.attributes };
  const payload = makePayload(kind, merged, old.createdAt);
  const row = await db.prepare(
    "UPDATE records SET payload=?, updated_at=? WHERE kind=? AND id=? AND updated_at=? RETURNING *",
  ).bind(JSON.stringify(payload), nextUpdate(old.updatedAt), kind, id, old.updatedAt).first();
  if (!row) throw new ApiError(409, "다른 화면에서 항목이 변경되었습니다. 새로고침한 뒤 다시 수정해 주세요.");
  return record(row);
}

export async function remove(db, kind, id) {
  const result = await db.prepare("DELETE FROM records WHERE kind=? AND id=? RETURNING id").bind(kind, id).first();
  if (!result) throw new ApiError(404, "등록 항목을 찾을 수 없습니다.");
}

export async function summary(db) {
  const [nodes, polygons, totals, statuses, imports, activity] = await db.batch([
    db.prepare(RECENT_SQL + " LIMIT 8").bind("node"),
    db.prepare(RECENT_SQL + " LIMIT 8").bind("polygon"),
    db.prepare("SELECT kind, COUNT(*) AS count FROM records GROUP BY kind"),
    db.prepare("SELECT json_extract(payload, '$.verificationStatus') AS status, COUNT(*) AS count FROM records WHERE kind='node' GROUP BY status"),
    db.prepare("SELECT * FROM import_logs ORDER BY id DESC LIMIT 5"),
    db.prepare(REVISION_SQL),
  ]);
  const counts = Object.fromEntries(totals.results.map((row) => [row.kind, row.count]));
  return {
    nodeCount: counts.node || 0,
    polygonCount: counts.polygon || 0,
    verificationCounts: {
      verified: 0, not_reviewed: 0, needs_update: 0,
      ...Object.fromEntries(statuses.results.map((row) => [row.status, row.count])),
    },
    recentNodes: nodes.results.map(record),
    recentPolygons: polygons.results.map(record),
    recentImports: imports.results.map((row) => ({
      filename: row.filename, importedAt: row.imported_at, ...JSON.parse(row.result),
    })),
    lastChange: JSON.parse(activity.results[0].change),
  };
}

export async function exportCollection(db) {
  const { results } = await db.prepare(ALL_SQL).all();
  return {
    type: "FeatureCollection",
    bfm: { schemaVersion: 2, filename: BACKUP_NAME, exportedAt: new Date().toISOString() },
    features: results.map((row) => {
      const { paths, lat, lng, ...properties } = record(row);
      const polygon = row.kind === "polygon";
      return {
        type: "Feature",
        geometry: polygon
          ? { type: "Polygon", coordinates: [[...paths, paths[0]]] }
          : { type: "Point", coordinates: [lng, lat] },
        properties: polygon ? { ...properties, kind: "hazard" } : { ...properties.attributes, ...properties },
      };
    }),
  };
}

function sameLegacyRecord(kind, item, input) {
  if (normaliseName(item.payload.name) !== normaliseName(input.name)) return false;
  return kind === "node"
    ? item.payload.category === input.category &&
      Math.abs(item.payload.lat - input.lat) < 0.000001 &&
      Math.abs(item.payload.lng - input.lng) < 0.000001
    : JSON.stringify(item.payload.paths) === JSON.stringify(input.paths);
}

function planImport(collection, rows, timestamp) {
  const result = { created: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [], skipDetails: [] };
  const current = new Map(rows.map((row) => [
    `${row.kind}:${row.origin_id}`,
    { kind: row.kind, originId: row.origin_id, updatedAt: row.updated_at, payload: JSON.parse(row.payload) },
  ]));
  const writes = new Map();
  collection.features.forEach((feature, index) => {
    try {
      if (feature?.type !== "Feature") throw new ApiError(400, "Feature 형식이 아닙니다.");
      const type = feature.geometry?.type;
      const kind = type === "Point" ? "node" : "polygon";
      if (type !== "Point" && type !== "Polygon") throw new ApiError(400, "Point 또는 Polygon만 가져올 수 있습니다.");
      if (type === "Point" && (!Array.isArray(feature.geometry.coordinates) ||
        !feature.geometry.coordinates.slice(0, 2).every(Number.isFinite) || feature.geometry.coordinates.length < 2)) {
        throw new ApiError(400, "장소 좌표가 올바르지 않습니다.");
      }
      if (type === "Polygon" && feature.geometry.coordinates?.length !== 1) {
        throw new ApiError(400, "외곽선 하나로 구성된 위험 구역만 지원합니다.");
      }
      const input = kind === "node" ? asNodeFeature(feature) : asPolygonFeature(feature);
      input.originId = originId(input.originId);
      const previous = input.originId ? current.get(`${kind}:${input.originId}`) :
        Array.from(current.values()).find((item) => item.kind === kind && sameLegacyRecord(kind, item, input));
      const payload = makePayload(kind, input, previous?.payload.createdAt || input.createdAt || timestamp);
      if (previous) {
        const skip = importSkipReason(input, previous);
        if (skip) {
          result.skipped += 1;
          if (result.skipDetails.length < 20) result.skipDetails.push({ index: index + 1, message: skip });
          return;
        }
      }
      const next = { kind, originId: input.originId || crypto.randomUUID(), updatedAt: input.updatedAt || timestamp, payload };
      const key = `${kind}:${next.originId}`;
      current.set(key, next);
      writes.set(key, next);
      result[previous ? "updated" : "created"] += 1;
    } catch (error) {
      result.errors += 1;
      if (result.errorDetails.length < 20) result.errorDetails.push({ index: index + 1, message: error instanceof ApiError ? error.message : "좌표 또는 속성 형식이 올바르지 않습니다." });
    }
  });
  return { result, writes };
}

function writeStatements(db, writes) {
  const encoder = new TextEncoder();
  const statements = [];
  let group = [];
  let bytes = 2;
  for (const item of writes.values()) {
    const value = JSON.stringify(item);
    const size = encoder.encode(value).length + 1;
    if (size >= 1_900_000) throw new ApiError(413, "한 항목의 데이터가 너무 큽니다.");
    if (bytes + size >= 1_900_000) {
      statements.push(db.prepare(UPSERT_SQL).bind(`[${group.join(",")}]`));
      group = [];
      bytes = 2;
    }
    group.push(value);
    bytes += size;
  }
  if (group.length) statements.push(db.prepare(UPSERT_SQL).bind(`[${group.join(",")}]`));
  return statements;
}

export async function importCollection(db, collection) {
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new ApiError(400, "GeoJSON FeatureCollection 파일을 선택해 주세요.");
  }
  if (collection.features.length > 5000) throw new ApiError(400, "한 번에 5,000개 이하의 항목만 가져올 수 있습니다.");
  const [activity, rows] = await db.batch([db.prepare(REVISION_SQL), db.prepare(ALL_SQL)]);
  const revision = activity.results[0].revision;
  const at = new Date().toISOString();
  const name = String(collection.bfm?.filename || "").slice(0, 255);
  const { result, writes } = planImport(collection, rows.results, at);
  const change = { action: "geojson-imported", name, at, ...result };
  try {
    // The CHECK constraint rejects a stale snapshot and rolls back the whole batch.
    await db.batch([
      db.prepare("UPDATE activity SET revision=CASE WHEN revision=? THEN revision ELSE -1 END WHERE id=1").bind(revision),
      ...writeStatements(db, writes),
      db.prepare("INSERT INTO import_logs (filename, imported_at, result) VALUES (?,?,?)").bind(name, at, JSON.stringify(result)),
      db.prepare("UPDATE activity SET revision=revision+1, change=? WHERE id=1").bind(JSON.stringify(change)),
    ]);
  } catch (error) {
    if (error.message?.includes("revision >= 0")) {
      throw new ApiError(409, "병합 중 다른 변경이 저장되었습니다. 같은 파일을 다시 선택해 주세요.");
    }
    throw error;
  }
  return result;
}
