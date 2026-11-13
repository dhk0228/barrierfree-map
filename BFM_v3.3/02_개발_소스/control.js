/* 운영 콘솔: 서버가 보내는 변경 이벤트로 통계를 즉시 다시 그린다. */
const $ = (id) => document.getElementById(id);
const escapeText = (value) => {
  const node = document.createElement("span");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const changeLabels = {
  "node-created": "장소 등록",
  "node-updated": "장소 수정",
  "node-deleted": "장소 삭제",
  "polygon-created": "위험 구역 등록",
  "polygon-updated": "위험 구역 수정",
  "polygon-deleted": "위험 구역 삭제",
  "geojson-imported": "GeoJSON 병합",
};
const mergeCounts = (result) =>
  `추가 ${result.created} · 갱신 ${result.updated} · 건너뜀 ${result.skipped} · 오류 ${result.errors}`;
let summaryRequest = 0;
let live = false;
let shownChange;
function renderList(id, values, render, emptyText) {
  $(id).innerHTML = values.length
    ? values.map((value) => `<article>${render(value)}</article>`).join("")
    : `<p class="empty">${emptyText}</p>`;
}
function updateMessage(message, error = false) {
  const target = $("message");
  target.textContent = message;
  target.classList.toggle("error", error);
}
function renderLastChange(change) {
  const key = JSON.stringify(change);
  if (key === shownChange) return;
  shownChange = key;
  const time = $("last-change-time");
  time.hidden = !change;
  $("last-change").textContent = change
    ? [changeLabels[change.action], change.name, change.action === "geojson-imported" && mergeCounts(change)]
        .filter(Boolean).join(" · ")
    : "이번 실행에서 저장된 변경이 없습니다.";
  if (change) {
    time.dateTime = change.at;
    time.textContent = new Date(change.at).toLocaleTimeString("ko-KR");
  }
}
async function loadSummary() {
  const request = ++summaryRequest;
  try {
    const data = await BFMApi.request("/api/console/summary");
    if (request !== summaryRequest) return;
    $("server-status").textContent = live ? "실시간 연결됨" : "조회 가능 · 실시간 연결 대기";
    $("server-status").classList.remove("offline");
    $("node-count").textContent = data.nodeCount;
    $("polygon-count").textContent = data.polygonCount;
    $("verified-count").textContent = data.verificationCounts.verified;
    $("review-count").textContent =
      data.verificationCounts.not_reviewed +
      data.verificationCounts.needs_update;
    $("database-path").textContent = data.databasePath || "서버에서 관리하는 데이터";
    $("copy-path").hidden = !data.databasePath;
    renderLastChange(data.lastChange || null);
    renderList(
      "recent-nodes",
      data.recentNodes.slice(0,3),
      (node) =>
        `<strong>${escapeText(node.name)}</strong><span>${escapeText(({building:"건축물",ramp:"경사로",elevator:"엘리베이터",transport:"교통",toilet:"화장실",obstacle:"장애물",other:"기타"})[node.category]||"기타")} · ${node.verificationStatus === "verified" ? "검토됨" : "검토 필요"}</span>`,
      "등록된 장소가 없습니다.",
    );
    renderList(
      "recent-polygons",
      data.recentPolygons.slice(0,3),
      (polygon) =>
        `<strong>${escapeText(polygon.name)}</strong><span>${polygon.paths.length}개 꼭짓점</span>`,
      "등록된 위험 구역이 없습니다.",
    );
    renderList(
      "recent-imports",
      data.recentImports,
      (item) =>
        `<strong>${escapeText(item.filename || "이름 없는 GeoJSON")}</strong><span>추가 ${item.created} · 갱신 ${item.updated} · 건너뜀 ${item.skipped}${item.errorDetails.length ? " · 항목 오류 있음" : ""}</span>`,
      "가져오기 이력이 없습니다.",
    );
    updateMessage(`마지막 확인 ${new Date().toLocaleTimeString("ko-KR")}`);
  } catch (error) {
    if (request !== summaryRequest) return;
    $("server-status").textContent = "연결 확인 필요";
    $("server-status").classList.add("offline");
    updateMessage(`동기화 실패: ${error.message}`, true);
  }
}
async function importGeoJson(file) {
  const button = $("btn-import");
  const status = $("import-status");
  const target = $("import-result");
  if (button.disabled) return;
  button.disabled = true;
  target.hidden = true;
  status.classList.remove("error");
  status.textContent = "GeoJSON을 병합하는 중입니다.";
  try {
    const result = await BFMApi.importGeoJson(file);
    status.textContent = `병합 완료 · ${mergeCounts(result)}`;
    const details = [
      ...result.skipDetails.map(({ index, message }) => `항목 ${index} 건너뜀 · ${message}`),
      ...result.errorDetails.map(({ index, message }) => `항목 ${index} 오류 · ${message}`),
    ];
    if (details.length) {
      target.innerHTML = `<summary>건너뜀·오류 세부 정보 (유형별 최대 20건)</summary><ul>${details
        .map((detail) => `<li>${escapeText(detail)}</li>`).join("")}</ul>`;
      target.hidden = false;
    }
    await loadSummary();
  } catch (error) {
    status.classList.add("error");
    status.textContent = `가져오기 실패 · ${error.message}`;
  } finally {
    button.disabled = false;
    $("import-file").value = "";
  }
}
// SSE가 끊겨도 브라우저가 재연결한다. 수동 새로고침은 예외 상황을 위한 보조 기능이다.
function connectEvents() {
  const eventSource = BFMApi.events();
  if (!eventSource) return;
  eventSource.addEventListener("data-changed", () => loadSummary());
  eventSource.onopen = () => {
    live = true;
    loadSummary();
  };
  eventSource.onerror = () => {
    live = false;
    $("server-status").textContent = "실시간 연결 재시도 중…";
    $("server-status").classList.add("offline");
  };
}
$("refresh").addEventListener("click", loadSummary);
$("import-file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importGeoJson(file);
});
$("copy-path").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("database-path").textContent);
    updateMessage("데이터 경로를 복사했습니다.");
  } catch {
    updateMessage("경로 복사를 지원하지 않는 환경입니다.", true);
  }
});
window.addEventListener("focus", loadSummary);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadSummary();
});
loadSummary();
connectEvents();

$("btn-import").onclick = () => $("import-file").click();
