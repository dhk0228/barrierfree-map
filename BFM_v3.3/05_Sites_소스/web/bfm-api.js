/* 지도와 운영 콘솔이 같은 출처의 HTTP API를 사용한다. */
window.BFMApi = {
  async request(url, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, { cache: "no-store", ...options, headers });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object" || !("data" in body)) {
      throw new Error(body?.error || "서버 응답을 확인할 수 없습니다.");
    }
    return body.data;
  },

  watchChanges({ refresh, onStatus = () => {} }) {
    let revision;
    let pending = false;
    async function poll() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const current = await BFMApi.request("/api/revision");
        onStatus(true);
        if (current !== revision) {
          const loaded = await refresh();
          if (loaded !== false) revision = current;
        }
      } catch {
        onStatus(false);
      } finally {
        pending = false;
      }
    }
    window.setInterval(poll, 4000);
    document.addEventListener("visibilitychange", poll);
    poll();
  },

  async importGeoJson(file) {
    const collection = JSON.parse(await file.text());
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new Error("GeoJSON FeatureCollection 파일을 선택해 주세요.");
    }
    collection.bfm = { filename: file.name };
    return this.request("/api/import.geojson", {
      method: "POST",
      body: JSON.stringify(collection),
    });
  },
};
