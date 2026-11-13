const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { startServer } = require("./server");

const closeDb = (db) => new Promise((resolve) => db.close(resolve));
const run = (db, sql) =>
  new Promise((resolve, reject) =>
    db.exec(sql, (error) => (error ? reject(error) : resolve())),
  );
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".bfm-v3-test-"));
  const databasePath = path.join(directory, "v1.sqlite");
  const legacy = new sqlite3.Database(databasePath);
  await run(
    legacy,
    `CREATE TABLE nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, color TEXT, attributes TEXT NOT NULL DEFAULT '{}', lat REAL NOT NULL, lng REAL NOT NULL);
    CREATE TABLE polygons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, paths TEXT NOT NULL);
    INSERT INTO nodes (name, category, color, attributes, lat, lng) VALUES ('기존 장소', 'building', '#3b82f6', '{"wheelchair":true}', 34.8916, 128.6433);`,
  );
  await closeDb(legacy);

  const { server, close } = startServer({ dbPath: databasePath, port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, options) => {
    const response = await fetch(`${origin}${url}`, options);
    return {
      response,
      body: response.status === 204 ? null : await response.json(),
    };
  };
  let reader;
  try {
    let result = await request("/api/config");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.schemaVersion, 2);
    assert.match(result.body.data.tileUrl, /\{z\}/);
    result = await request("/api/nodes");
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].verificationStatus, "not_reviewed");
    assert.ok(result.body.data[0].originId);

    const sseResponse = await fetch(`${origin}/api/events`);
    reader = sseResponse.body.getReader();
    const connected = await reader.read();
    assert.match(new TextDecoder().decode(connected.value), /event: connected/);
    const node = {
      name: "검토된 경사로",
      category: "ramp",
      color: "#f97316",
      lat: 34.8917,
      lng: 128.6434,
      verificationStatus: "verified",
      verifiedAt: "2026-09-01",
      sourceNote: "현장 확인",
      attributes: { wheelchair: true, braille: true, toilet: false },
    };
    result = await request("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(node),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.data.verificationStatus, "verified");
    const nodeId = result.body.data.id;
    const initialNodeTime = result.body.data.updatedAt;
    const dataChanged = await Promise.race([
      reader.read(),
      wait(2000).then(() => {
        throw new Error("SSE data-changed timeout");
      }),
    ]);
    const event = new TextDecoder().decode(dataChanged.value);
    assert.match(event, /data-changed/);
    assert.match(event, /"name":"검토된 경사로"/);
    result = await request(`/api/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...node,
        name: "수정된 경사로",
        verificationStatus: "needs_update",
      }),
    });
    assert.equal(result.body.data.name, "수정된 경사로");
    assert.equal(result.body.data.verificationStatus, "needs_update");
    assert.ok(result.body.data.updatedAt > initialNodeTime);
    result = await request("/api/console/summary");
    assert.equal(result.body.data.lastChange.action, "node-updated");
    assert.equal(result.body.data.lastChange.name, "수정된 경사로");
    assert.equal(result.body.data.recentNodes[0].id, nodeId);
    result = await request("/api/polygons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "테스트 위험구역",
        paths: [
          [128.643, 34.891],
          [128.644, 34.891],
          [128.644, 34.892],
        ],
      }),
    });
    assert.equal(result.response.status, 201);
    const polygon = result.body.data;
    result = await request(`/api/polygons/${polygon.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "수정된 위험구역" }),
    });
    assert.equal(result.body.data.name, "수정된 위험구역");
    assert.deepEqual(result.body.data.paths, polygon.paths);
    assert.ok(result.body.data.updatedAt > polygon.updatedAt);
    const exportResponse = await fetch(`${origin}/api/export.geojson`);
    const exported = await exportResponse.json();
    assert.equal(exportResponse.status, 200);
    assert.equal(exported.bfm.schemaVersion, 2);
    assert.equal(exported.features.length, 3);
    assert.ok(
      exported.features.find((feature) => feature.geometry.type === "Point")
        .properties.originId,
    );
    result = await request("/api/import.geojson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    assert.equal(result.body.data.created, 0);
    assert.equal(result.body.data.skipped, 3);
    const noTimestampCollection = structuredClone(exported);
    const noTimestampFeature = noTimestampCollection.features.find(
      (feature) =>
        feature.geometry.type === "Point" &&
        feature.properties.name === "수정된 경사로",
    );
    noTimestampFeature.properties.name = "덮어쓰면 안 되는 이름";
    delete noTimestampFeature.properties.updatedAt;
    result = await request("/api/import.geojson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(noTimestampCollection),
    });
    assert.equal(result.body.data.updated, 0);
    assert.equal(result.body.data.skipped, 3);
    assert.ok(
      result.body.data.skipDetails.some(
        (item) => item.message === "병합 기준 시각 없음",
      ),
    );
    const updateCollection = structuredClone(exported);
    const updateFeature = updateCollection.features.find(
      (feature) =>
        feature.geometry.type === "Point" &&
        feature.properties.name === "수정된 경사로",
    );
    updateFeature.properties.name = "병합된 경사로";
    updateFeature.properties.updatedAt = "2030-01-01T00:00:00.000Z";
    updateCollection.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [128.65, 34.89] },
      properties: { name: "새 장소", category: "other" },
    });
    updateCollection.features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: {},
    });
    result = await request("/api/import.geojson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateCollection),
    });
    assert.equal(result.body.data.updated, 1);
    assert.equal(result.body.data.created, 1);
    assert.equal(result.body.data.errors, 1);
    result = await request("/api/console/summary");
    assert.equal(result.body.data.nodeCount, 3);
    assert.equal(result.body.data.polygonCount, 1);
    assert.equal(result.body.data.verificationCounts.verified, 0);
    assert.ok(result.body.data.recentImports.length >= 2);
    result = await request("/api/geocode/search?q=");
    assert.equal(result.response.status, 400);
    result = await request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(result.response.status, 400);
    console.log("BFM v3 API, migration, GeoJSON merge and SSE tests passed");
  } finally {
    await reader?.cancel();
    await new Promise((resolve) => close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
