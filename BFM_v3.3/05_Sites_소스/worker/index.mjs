import assets from "./assets.mjs";
import { routeHitsPolygon, validLng } from "./domain.mjs";
import {
  ApiError, BACKUP_NAME, REVISION_SQL, create, exportCollection,
  importCollection, list, remove, summary, update,
} from "./records.mjs";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const FOOT_ROUTE_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const JSON_LIMIT = 2 * 1024 * 1024;
const PAGE_PATHS = { "/": "/barrier_free_map.html", "/control": "/control.html" };

function json(data, status = 200) {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error, status) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function readObject(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new ApiError(415, "JSON 요청 형식을 사용해 주세요.");
  }
  if (!request.body) throw new ApiError(400, "요청 본문이 비어 있습니다.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > JSON_LIMIT) {
      await reader.cancel();
      throw new ApiError(413, "요청 본문은 2MB 이하여야 합니다.");
    }
    text += decoder.decode(value, { stream: true });
  }
  let value;
  try {
    value = JSON.parse(text + decoder.decode());
  } catch {
    throw new ApiError(400, "올바른 JSON 형식이 아닙니다.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "JSON 객체가 필요합니다.");
  }
  return value;
}

function page(path) {
  const key = Object.hasOwn(PAGE_PATHS, path) ? PAGE_PATHS[path] : path;
  const asset = Object.hasOwn(assets, key) ? assets[key] : null;
  if (!asset) return new Response("페이지를 찾을 수 없습니다.", { status: 404 });
  const html = asset.type.startsWith("text/html");
  const headers = {
    "Content-Type": asset.type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": html ? "no-store" : "private, max-age=300",
  };
  if (html) headers["Content-Security-Policy"] =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
  return new Response(asset.base64 ? Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0)) : asset.text, { headers });
}

async function reserveProviderRequest(db, provider) {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO provider_requests (provider,last_requested)
    VALUES (?,?) ON CONFLICT (provider) DO UPDATE SET last_requested=excluded.last_requested
    WHERE excluded.last_requested - provider_requests.last_requested >= 1100 RETURNING provider`)
    .bind(provider, now).first();
  if (!row) throw new ApiError(429, "잠시 후 다시 요청해 주세요.");
}

async function route(db, env, url, input) {
  const { start, end, accessibleMode = true } = input;
  const isPoint = (point) => point && point.lat != null && point.lng != null &&
    Math.abs(Number(point.lat)) <= 90 && validLng(Number(point.lng));
  if (!isPoint(start) || !isPoint(end)) throw new ApiError(400, "출발지와 도착지 좌표를 확인해 주세요.");
  await reserveProviderRequest(db, "route");
  const coordinates = [start, end].map(({ lat, lng }) => `${Number(lng)},${Number(lat)}`).join(";");
  const base = env.BFM_ROUTE_URL || FOOT_ROUTE_URL;
  const target = new URL(`${base.replace(/\/$/, "")}/${coordinates}`);
  target.search = new URLSearchParams({ overview: "full", geometries: "geojson", alternatives: "true" });
  const options = {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": `BarrierFreeMap/3.3 (${url.origin})`, Referer: `${url.origin}/` },
  };
  let payload;
  try {
    const response = await fetch(target, options);
    if (!response.ok) throw new Error("upstream");
    payload = await response.json();
  } catch {
    throw new ApiError(502, "보행 경로 서비스에 연결할 수 없습니다.");
  }
  if (payload.code !== "Ok" || !payload.routes?.length) {
    throw new ApiError(422, "두 지점 사이의 보행 경로를 찾지 못했습니다.");
  }
  const [polygons, nodes] = await Promise.all([list(db, "polygon"), list(db, "node")]);
  const candidates = payload.routes.map((item) => ({
    item,
    hazards: polygons.filter((polygon) => routeHitsPolygon(item.geometry.coordinates, polygon.paths))
      .map(({ id, name }) => ({ id, name })),
  }));
  candidates.sort((a, b) => {
    const byHazards = accessibleMode ? a.hazards.length - b.hazards.length : 0;
    return byHazards || a.item.distance - b.item.distance;
  });
  const { item, hazards } = candidates[0];
  const nearby = nodes.filter((node) => [start, end].some((point) =>
    Math.abs(node.lat - Number(point.lat)) < 0.015 &&
    Math.abs(node.lng - Number(point.lng)) < 0.015));
  const nearbyAccessibility = Object.fromEntries(["wheelchair", "braille", "toilet"].map((key) => [
    key, nearby.filter((node) => node.attributes[key]).length,
  ]));
  return {
    geometry: item.geometry, distance: item.distance, duration: item.duration,
    hazards, status: hazards.length ? "caution" : nearbyAccessibility.wheelchair ? "good" : "unknown",
    alternativesChecked: candidates.length, nearbyAccessibility,
  };
}

async function api(request, env, url) {
  if (!request.headers.get("oai-authenticated-user-id")) {
    throw new ApiError(401, "이 사이트에 로그인한 뒤 다시 시도해 주세요.");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin)) {
    throw new ApiError(403, "사이트에서 직접 요청해 주세요.");
  }
  const db = env.DB;
  const { pathname } = url;
  const { method } = request;
  if (method === "GET") {
    if (pathname === "/api/config") return json({ tileUrl: env.BFM_TILE_URL || TILE_URL, schemaVersion: 2 });
    if (pathname === "/api/revision") {
      const { revision } = await db.prepare(REVISION_SQL).first();
      return json(revision);
    }
    if (pathname === "/api/console/summary") return json(await summary(db));
    if (pathname === "/api/export.geojson") {
      return new Response(JSON.stringify(await exportCollection(db)), {
        headers: {
          "Content-Type": "application/geo+json; charset=utf-8",
          "Content-Disposition": `attachment; filename="bfm-sites.geojson"; filename*=UTF-8''${encodeURIComponent(BACKUP_NAME)}`,
          "Cache-Control": "no-store",
        },
      });
    }
  }
  if (method === "POST" && pathname === "/api/import.geojson") {
    return json(await importCollection(db, await readObject(request)));
  }
  if (method === "POST" && pathname === "/api/routes") {
    return json(await route(db, env, url, await readObject(request)));
  }
  const match = /^\/api\/(nodes|polygons)(?:\/(\d+))?$/.exec(pathname);
  if (match) {
    const kind = match[1] === "nodes" ? "node" : "polygon";
    const id = Number(match[2]);
    if (!match[2]) {
      if (method === "GET") return json(await list(db, kind));
      if (method === "POST") return json(await create(db, kind, await readObject(request)), 201);
    } else if (Number.isSafeInteger(id)) {
      if (method === "PATCH") return json(await update(db, kind, id, await readObject(request)));
      if (method === "DELETE") {
        await remove(db, kind, id);
        return new Response(null, { status: 204 });
      }
    }
  }
  return errorResponse("API 경로를 찾을 수 없습니다.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      if (request.method === "GET" || request.method === "HEAD") return page(url.pathname);
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error.message, error.status);
      console.error("BFM Sites API", url.pathname, error.name);
      return errorResponse("데이터를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
    }
  },
};
