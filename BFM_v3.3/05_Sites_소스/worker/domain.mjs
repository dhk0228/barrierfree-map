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

export { validateNode, validatePolygon, routeHitsPolygon, validLng, normaliseName, isoDate, nextUpdate, asNodeFeature, asPolygonFeature, importSkipReason };
