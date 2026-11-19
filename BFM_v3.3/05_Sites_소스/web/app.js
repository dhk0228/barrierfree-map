/* 웹 지도 화면: API 통신, Leaflet 표시, 탭·모달·목록 상호작용을 담당한다. */
document.addEventListener("DOMContentLoaded", () => {
  const category = {
    building: ["건축물", "#3b82f6", "🏢"],
    ramp: ["경사로", "#f97316", "♿"],
    elevator: ["엘리베이터", "#10b981", "↕️"],
    transport: ["교통", "#8b5cf6", "🚌"],
    toilet: ["화장실", "#06b6d4", "🚻"],
    obstacle: ["장애물", "#ef4444", "⚠️"],
    other: ["기타", "#64748b", "📌"],
  };
  const ids = [
    "map-status",
    "route-float",
    "sidebar",
    "btn-sheet-toggle",
    "btn-overview",
    "btn-my-location",
    "btn-info-open",
    "btn-info-close",
    "btn-contrast",
    "global-search",
    "btn-global-search",
    "geocode-results",
    "input-start",
    "input-end",
    "autocomplete-list-start",
    "autocomplete-list-end",
    "btn-swap-route",
    "search-wheelchair-mode",
    "btn-search",
    "btn-clear-path",
    "filter-category",
    "coord-list",
    "btn-draw-polygon",
    "btn-undo-polygon",
    "btn-reset-polygon",
    "btn-finish-polygon",
    "btn-cancel-polygon",
    "polygon-hint",
    "polygon-name",
    "polygon-name-wrap",
    "polygon-list-container",
    "stats-container",
    "import-file",
    "import-result",
    "recent-changes",
    "node-modal",
    "info-modal",
    "node-form",
    "node-name",
    "node-category",
    "node-image",
    "attr-wheelchair",
    "attr-braille",
    "attr-toilet",
    "verification-status",
    "verified-at",
    "source-note",
    "btn-modal-cancel",
    "btn-modal-secondary",
    "node-modal-title",
    "legend",
    "toast",
  ];
  const els = Object.fromEntries(
    ids.map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]),
  );
  const $ = (id) => document.getElementById(id);
  const registrationSubmit = BFMRegistration.createSubmissionGate();
  const polygonSubmit = BFMRegistration.createSubmissionGate();
  const icon = (name) => `<img class="ui-icon" src="assets/icons/${name}.svg" alt="" />`;
  const state = {
    endpoints: { start: null, end: null },
    selectedId: null,
    markers: new Map(),
    preview: null,
    routeRequest: 0,
    nodes: [],
    polygons: [],
    markerLayer: L.featureGroup(),
    polygonLayer: L.layerGroup(),
    routeLayer: null,
    temporaryLayer: null,
    drawing: false,
    editingPolygonId: null,
    points: [],
    selectedLatLng: null,
    filter: "all",
    tilesReady: false,
    dataRequest: 0,
  };
  const map = L.map("map", { zoomControl: true, fadeAnimation: !matchMedia("(prefers-reduced-motion: reduce)").matches, zoomAnimation: !matchMedia("(prefers-reduced-motion: reduce)").matches }).setView(
    [34.8916, 128.6433],
    16,
  );
  map.zoomControl.setPosition("bottomright");
  state.markerLayer.addTo(map);
  state.polygonLayer.addTo(map);
  const text = (value) => {
    const element = document.createElement("span");
    element.textContent = value ?? "";
    return element.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  };
  const labelForStatus = (status) =>
    ({
      verified: "✓ 검토됨",
      needs_update: "⚠ 정보 업데이트 필요",
      not_reviewed: "• 검토 필요",
    })[status] || "• 검토 필요";
  const classForStatus = (status) =>
    ["verified", "needs_update"].includes(status) ? status : "not_reviewed";
  const formatDate = (value) =>
    value
      ? new Intl.DateTimeFormat("ko-KR", {
          month: "numeric",
          day: "numeric",
        }).format(new Date(value))
      : "확인일 미입력";
  const api = BFMApi.request;
  const toast = (message, isError = false) => {
    els.toast.textContent = message;
    els.toast.className = `show${isError ? " error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      els.toast.className = "";
    }, 3600);
  };
  const setMapStatus = (message = "") => {
    els.map_status.textContent = message;
    els.map_status.hidden = !message;
  };
  const activate = (id) => {
    closeMenus();
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.tab === id;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.tab-content').forEach(panel => {
      panel.classList.toggle('active', panel.id === id);
      panel.hidden = panel.id !== id;
    });
    if (matchMedia('(max-width: 680px)').matches && els.sidebar.dataset.size === 'summary') setSheetSize('middle');
  };
  function fitVisible(bounds, collapse = true) {
    const mobile = matchMedia('(max-width: 680px)').matches;
    if (mobile && collapse) setSheetSize('summary');
    map.fitBounds(bounds, { paddingTopLeft: mobile ? [35, 95] : [460, 95], paddingBottomRight: mobile ? [35, collapse ? 230 : innerHeight * .58 + 110] : [80, 110], maxZoom: 18, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  }
  function clearRoute() {
    state.routeRequest++;
    if (state.routeLayer) map.removeLayer(state.routeLayer);
    state.routeLayer = null;
    els.route_float.hidden = true;
    els.btn_search.textContent = '경로 찾기';
  }
  function updateRouteState() {
    const count = Object.values(state.endpoints).filter(Boolean).length;
    $('route-progress').textContent = `${count} / 2`;
    els.btn_search.disabled = count !== 2;
    els.btn_global_search.classList.toggle('button-primary', count !== 2);
    els.btn_global_search.classList.toggle('button-secondary', count === 2);
    if (count) $('route-workflow').open = true;
  }
  function setEndpoint(kind, place) {
    if (!place) return;
    clearRoute();
    state.endpoints[kind] = { ...place, name: place.name || place.displayName.split(',')[0] };
    els[`input_${kind}`].value = state.endpoints[kind].name;
    activate('tab-search');
    updateRouteState();
    toast(`${kind === 'start' ? '출발지' : '도착지'}를 지정했습니다.`);
    requestAnimationFrame(() => $('route-workflow').scrollIntoView({block:'nearest'}));
  }
  function selectPlace(place) {
    const selected = $('selected-place');
    selected.hidden = false;
    selected.innerHTML = `<p class="eyebrow">SELECTED PLACE</p><h2>${text(place.name || place.displayName.split(',')[0])}</h2><p class="selection-meta">${place.id ? text(labelForStatus(place.verificationStatus)) : '검색된 위치 · 접근성 정보 미확인'}</p><button class="button button-secondary" id="selection-view">${icon('pin')}지도에서 보기</button><div class="button-row"><button class="button button-secondary" id="selection-start">출발지로 설정</button><button class="button button-secondary" id="selection-end">도착지로 설정</button></div>`;
    $('selection-view').onclick = () => fitVisible(L.latLngBounds([[place.lat,place.lng],[place.lat,place.lng]]));
    $('selection-start').onclick = () => setEndpoint('start',place);
    $('selection-end').onclick = () => setEndpoint('end',place);
    state.selectedId = place.id || null;
    document.querySelectorAll('.bfm-marker').forEach(el => el.classList.remove('selected-marker'));
    state.markers.get(place.id)?.getElement()?.classList.add('selected-marker');
    if (state.searchMarker) map.removeLayer(state.searchMarker);
    if (!place.id) state.searchMarker = L.marker([place.lat,place.lng], { title: place.displayName, icon: L.divIcon({className:'search-pin', html:icon('pin'), iconSize:[40,40],iconAnchor:[20,40]}) }).addTo(map);
    const revealSelection = matchMedia('(max-width:680px)').matches && $('tab-search').classList.contains('active');
    if (revealSelection) {
      setSheetSize('middle');
      requestAnimationFrame(() => selected.scrollIntoView({block:'start'}));
    }
    fitVisible(L.latLngBounds([[place.lat,place.lng],[place.lat,place.lng]]), !revealSelection);
  }
  function closeMenus(restore = false) {
    document.querySelectorAll('.more-menu[open]').forEach(menu => { menu.open = false; if (restore) menu.querySelector('summary').focus(); });
  }
  function confirmDelete(name) {
    return new Promise(resolve => {
      const dialog = $('delete-dialog');
      $('delete-message').textContent = `‘${name}’ 항목을 삭제합니다.`;
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), {once:true});
      dialog.showModal();
    });
  }
  const markerIcon = (node) => {
    const [, color, emoji] = category[node.category] || category.other;
    return L.divIcon({
      className: "bfm-marker",
      html: `<span style="background:${color}"><b>${emoji}</b></span>`,
      iconSize: [39, 39],
      iconAnchor: [19, 39],
      popupAnchor: [0, -38],
    });
  };
  const popup = (node) => {
    const [, color, emoji] = category[node.category] || category.other;
    const attrs = [];
    if (node.attributes.wheelchair) attrs.push("♿ 휠체어");
    if (node.attributes.braille) attrs.push("⠃ 점자");
    if (node.attributes.toilet) attrs.push("🚻 화장실");
    return `<article class="map-popup"><strong>${text(node.name)}</strong><span class="status-pill ${classForStatus(node.verificationStatus)}">${text(labelForStatus(node.verificationStatus))}</span><p>${emoji} ${text(category[node.category]?.[0] || "기타")}${attrs.length ? ` · ${attrs.join(" · ")}` : ""}</p><div class="popup-actions"><button data-route="start" data-id="${node.id}">출발지</button><button data-route="end" data-id="${node.id}">도착지</button><button data-edit="${node.id}">수정</button></div></article>`;
  };
  function renderMap() {
    state.markerLayer.clearLayers();
    state.markers.clear();
    state.nodes
      .filter(
        (node) => state.filter === "all" || node.category === state.filter,
      )
      .forEach((node) => {
        const marker = L.marker([node.lat, node.lng], {
          icon: markerIcon(node), title: node.name, alt: node.name,
        }).bindPopup(popup(node));
        marker.on('click', () => {
          if (state.drawing) {
            activate("tab-zone");
            map.closePopup();
            return;
          }
          activate("tab-search");
          selectPlace(node);
        });
        marker.on('popupopen', () => {
          const content = marker.getPopup().getElement();
          content.querySelectorAll('[data-route]').forEach(button => button.onclick = () => { setEndpoint(button.dataset.route,node); map.closePopup(); });
          content.querySelector('[data-edit]').onclick = () => openNode(node);
        });
        state.markers.set(node.id, marker);
        state.markerLayer.addLayer(marker);
        marker.getElement()?.setAttribute('aria-label', `${node.name} 지도에서 보기`);
        if (state.selectedId === node.id) marker.getElement()?.classList.add('selected-marker');
      });
    state.polygonLayer.clearLayers();
    state.polygons.filter((polygon) => polygon.id !== state.editingPolygonId).forEach((polygon) =>
      state.polygonLayer.addLayer(
        // 저장·GeoJSON 좌표는 [경도, 위도]이고 Leaflet만 [위도, 경도]를 사용한다.
        L.polygon(
          polygon.paths.map(([lng, lat]) => [lat, lng]),
          {
            color: "#b15b70",
            fillColor: "#fb7185",
            fillOpacity: 0.16,
            weight: 2,
          },
        ).bindTooltip(`⚠ ${text(polygon.name)}`, {permanent:true, direction:"center", className:"zone-label"}),
      ),
    );
  }
  function renderList() {
    const list = state.nodes.filter(node => state.filter === 'all' || node.category === state.filter);
    els.coord_list.innerHTML = list.length ? list.map(node => `<article class="item-card${state.selectedId === node.id ? ' selected' : ''}"><button type="button" class="place-body" data-focus="${node.id}" aria-label="${text(node.name)} 지도에서 보기"><strong>${text(node.name)}</strong><span class="status-pill ${classForStatus(node.verificationStatus)}">${text(labelForStatus(node.verificationStatus))}</span><span class="place-meta">${text(category[node.category]?.[0] || '기타')} · ${text(formatDate(node.verifiedAt))}</span></button><details class="more-menu"><summary aria-label="${text(node.name)} 더보기" title="${text(node.name)} 더보기">${icon('more')}</summary><div class="menu-items"><button data-edit="${node.id}">장소 수정</button><button data-start="${node.id}">출발지로 설정</button><button data-end="${node.id}">도착지로 설정</button><button class="danger-action" data-delete="${node.id}">${icon('trash')}삭제</button></div></details></article>`).join('') : '<p class="empty">등록된 장소가 없습니다. 지도 도구의 + 버튼으로 첫 장소를 추가하세요.</p>';
    els.coord_list.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => focusNode(Number(button.dataset.focus)));
    els.coord_list.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => { closeMenus(); openNode(state.nodes.find(node => node.id === Number(button.dataset.edit))); });
    for (const kind of ['start','end']) els.coord_list.querySelectorAll(`[data-${kind}]`).forEach(button => button.onclick = () => setEndpoint(kind,state.nodes.find(node => node.id === Number(button.dataset[kind]))));
    els.coord_list.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => deleteNode(Number(button.dataset.delete)));
    wireMenus(els.coord_list);
  }
  function wireMenus(root) {
    root.querySelectorAll('.more-menu').forEach(menu => {
      menu.querySelector('summary').addEventListener('click', () => {
        root.querySelectorAll('.more-menu').forEach(other => { if (other !== menu) other.open = false; });
      });
      menu.addEventListener('keydown', event => {
        const buttons = [...menu.querySelectorAll('button')];
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault(); menu.open = true;
          let index = buttons.indexOf(document.activeElement);
          index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(event.key === 'ArrowDown' ? 1 : -1)+buttons.length)%buttons.length;
          buttons[index].focus();
        }
      });
    });
  }
  function renderPolygons() {
    els.polygon_list_container.innerHTML = state.polygons.length
      ? state.polygons.map((polygon) => `
        <article class="item-card">
          <button class="place-body" data-zone="${polygon.id}" aria-label="${text(polygon.name)} 지도에서 보기">
            <strong>${text(polygon.name)}</strong><span class="status-pill danger">⚠ 주의 구역</span>
            <span class="place-meta">${polygon.paths.length}개 꼭짓점 · ${text(formatDate(polygon.updatedAt))}</span>
          </button>
          <details class="more-menu">
            <summary aria-label="${text(polygon.name)} 더보기">${icon("more")}</summary>
            <div class="menu-items">
              <button data-edit-zone="${polygon.id}">위험 구역 수정</button>
              <button class="danger-action" data-delete-zone="${polygon.id}">${icon("trash")}삭제</button>
            </div>
          </details>
        </article>`).join("")
      : '<p class="empty">등록된 위험 구역이 없습니다.</p>';
    els.polygon_list_container.querySelectorAll('[data-zone]').forEach(button => button.onclick = () => {
      const polygon = state.polygons.find(item => item.id === Number(button.dataset.zone));
      fitVisible(L.latLngBounds(polygon.paths.map(([lng,lat]) => [lat,lng])));
    });
    els.polygon_list_container.querySelectorAll("[data-edit-zone]").forEach((button) => {
      button.onclick = () => {
        if (state.drawing) return toast("현재 구역을 저장하거나 취소해 주세요.", true);
        const polygon = state.polygons.find((item) => item.id === Number(button.dataset.editZone));
        if (!polygon) return;
        closeMenus();
        drawMode(true, polygon);
        fitVisible(L.latLngBounds(state.points), false);
      };
    });
    els.polygon_list_container.querySelectorAll('[data-delete-zone]').forEach(button => button.onclick = () => deletePolygon(Number(button.dataset.deleteZone)));
    wireMenus(els.polygon_list_container);
  }
  function renderStats() {
    const verified = state.nodes.filter(
      (node) => node.verificationStatus === "verified",
    ).length;
    const needsUpdate = state.nodes.filter(
      (node) => node.verificationStatus === "needs_update",
    ).length;
    $("map-summary").innerHTML = `<span class="live-label">LOCAL FIELD NOTES</span><strong>함께 기록한 이동 정보</strong><div><span>등록 장소 <b>${state.nodes.length}</b></span><span>검토 필요 <b>${state.nodes.length-verified}</b></span><span>위험 구역 <b>${state.polygons.length}</b></span></div>`;
    els.stats_container.innerHTML = [
      [state.nodes.length, "등록 장소"],
      [state.polygons.length, "위험 구역"],
      [verified, "검토됨"],
      [needsUpdate, "업데이트 필요"],
    ]
      .map(
        ([count, label]) =>
          `<div class="stat-tile"><strong>${count}</strong><span>${label}</span></div>`,
      )
      .join("");
    els.legend.innerHTML = Object.values(category)
      .map(
        ([label, color, emoji]) =>
          `<div class="legend-item"><i style="background:${color}"></i>${emoji} ${label}</div>`,
      )
      .join("");
    const changes = [
      ...state.nodes.map((node) => ({
        type: "장소",
        name: node.name,
        at: node.updatedAt,
        state: labelForStatus(node.verificationStatus),
      })),
      ...state.polygons.map((polygon) => ({
        type: "위험 구역",
        name: polygon.name,
        at: polygon.updatedAt,
        state: "주의 구역",
      })),
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 3);
    els.recent_changes.innerHTML = changes.length
      ? changes
          .map(
            (change) =>
              `<article><strong>${text(change.name)}</strong><span>${change.type} · ${text(change.state)} · ${text(formatDate(change.at))}</span></article>`,
          )
          .join("")
      : "<p>아직 변경된 데이터가 없습니다.</p>";
  }
  const renderAll = () => {
    renderMap();
    renderList();
    renderPolygons();
    renderStats();
  };
  function focusNode(id) {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) return;
    selectPlace(node);
    renderList();
  }
  function openNode(node = null) {
    if (registrationSubmit.pending) return;
    state.selectedLatLng = node
      ? L.latLng(node.lat, node.lng)
      : state.selectedLatLng;
    if (!state.selectedLatLng) state.selectedLatLng = map.getCenter();
    map.closePopup();
    $('node-save-error').hidden = true;
    els.node_form.removeAttribute('aria-busy');
    const point = state.selectedLatLng;
    $('node-location-help').textContent = `${node ? '등록된 장소의 정보를 수정합니다.' : state.registrationOrigin === 'toolbar' ? '현재 지도 중심에 등록합니다. 다른 위치는 창을 닫고 지도에서 선택하세요.' : '지도에서 선택한 위치에 등록합니다.'} (${point.lat.toFixed(6)}, ${point.lng.toFixed(6)})`;
    els.node_form.querySelector('details').open = false;
    els.node_form.dataset.editId = node?.id || "";
    els.node_modal_title.textContent = node ? "장소 정보 수정" : "장소 등록";
    els.node_name.value = node?.name || "";
    els.node_category.value = node?.category || "building";
    els.node_image.value = node?.attributes.image || "";
    els.attr_wheelchair.checked = node?.attributes.wheelchair ?? true;
    els.attr_braille.checked = node?.attributes.braille ?? false;
    els.attr_toilet.checked = node?.attributes.toilet ?? false;
    els.verification_status.value = node?.verificationStatus || "not_reviewed";
    els.verified_at.value = node?.verifiedAt
      ? new Date(node.verifiedAt).toISOString().slice(0, 10)
      : "";
    els.source_note.value = node?.sourceNote || "";
    showModal(els.node_modal);
    setTimeout(() => els.node_name.focus(), 0);
  }
  const closeNode = () => {
    if (registrationSubmit.pending) return;
    hideModal(els.node_modal);
    clearPreview();
    state.selectedLatLng = null;
  };
  async function deleteNode(id) {
    const node = state.nodes.find((item) => item.id === id);
    if (!node || !(await confirmDelete(node.name))) return;
    try {
      await api(`/api/nodes/${id}`, { method: "DELETE" });
      toast("장소를 삭제했습니다.");
      await loadData();
    } catch (error) {
      toast(error.message, true);
    }
  }
  async function deletePolygon(id) {
    if (state.drawing) return toast("현재 구역을 저장하거나 취소해 주세요.", true);
    const polygon = state.polygons.find((item) => item.id === id);
    if (!polygon || !(await confirmDelete(polygon.name)))
      return;
    try {
      await api(`/api/polygons/${id}`, { method: "DELETE" });
      toast("위험 구역을 삭제했습니다.");
      await loadData();
    } catch (error) {
      toast(error.message, true);
    }
  }
  function updateTemporary() {
    updateDrawingState();
    if (state.temporaryLayer) map.removeLayer(state.temporaryLayer);
    const pathOptions = {
      color: "#7c3aed",
      dashArray: "7 7",
      fillOpacity: 0.14,
      interactive: false,
    };
    if (state.points.length === 1)
      state.temporaryLayer = L.circleMarker(state.points[0], { ...pathOptions, radius: 5 }).addTo(map);
    else if (state.points.length === 2)
      state.temporaryLayer = L.polyline(state.points, pathOptions).addTo(map);
    else if (state.points.length >= 3)
      state.temporaryLayer = L.polygon(state.points, pathOptions).addTo(map);
    else state.temporaryLayer = null;
  }
  function drawMode(enabled, polygon = null) {
    state.drawing = enabled;
    state.editingPolygonId = polygon?.id ?? null;
    state.points = polygon ? polygon.paths.map(([lng, lat]) => L.latLng(lat, lng)) : [];
    if (state.temporaryLayer) map.removeLayer(state.temporaryLayer);
    state.temporaryLayer = null;
    els.polygon_name_wrap.hidden = !enabled;
    els.polygon_hint.hidden = !enabled;
    els.btn_draw_polygon.hidden = enabled;
    els.btn_undo_polygon.hidden = !enabled;
    els.btn_reset_polygon.hidden = !polygon;
    els.btn_finish_polygon.hidden = !enabled;
    els.btn_cancel_polygon.hidden = !enabled;
    if (enabled) {
      els.polygon_name.value = polygon?.name || "";
      els.polygon_name.focus();
    }
    map.getContainer().classList.toggle("crosshair", enabled);
    updateTemporary();
    renderMap();
    if (enabled) clearPreview();
  }
  function updateDrawingState() {
    const count = state.points.length;
    const pending = polygonSubmit.pending;
    els.btn_finish_polygon.disabled = pending || count < 3 || !els.polygon_name.value.trim();
    els.btn_undo_polygon.disabled = pending || count === 0;
    els.btn_reset_polygon.disabled = pending || count === 0;
    els.btn_cancel_polygon.disabled = pending;
    els.polygon_name.disabled = pending;
    els.btn_finish_polygon.textContent = pending ? "저장 중…" : state.editingPolygonId ? "수정 저장" : "저장";
    els.polygon_hint.textContent = count < 3
      ? `점 ${count}개 · 지도에서 ${3 - count}개 이상 더 선택해 주세요.`
      : `점 ${count}개 · 이름을 확인하고 저장해 주세요.`;
    document.querySelectorAll('#drawing-steps li').forEach((item,index) => {
      const active = index === (!state.drawing ? 0 : count < 3 ? 1 : 2);
      item.classList.toggle('active',active);
      if (active) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
    });
  }
  function searchPlace() {
    const query = els.global_search.value.trim().toLocaleLowerCase("ko-KR");
    if (!query) return;
    const results = state.nodes.filter((node) => node.name.toLocaleLowerCase("ko-KR").includes(query));
    if (!results.length) {
      els.geocode_results.innerHTML = '<p class="empty">검색 결과가 없습니다.</p>';
      return;
    }
    els.geocode_results.innerHTML = results
      .map((result, index) => `<button type="button" data-result="${index}">${text(result.name)}</button>`)
      .join("");
    els.geocode_results.querySelectorAll("[data-result]").forEach((button) => {
      button.onclick = () => {
        selectPlace(results[Number(button.dataset.result)]);
        els.geocode_results.innerHTML = "";
      };
    });
  }
  function autocomplete(input, list) {
    const kind = input === els.input_start ? 'start' : 'end';
    input.setAttribute('aria-controls',list.id);
    input.setAttribute('aria-expanded','false');
    input.addEventListener('input', () => {
      clearRoute(); state.endpoints[kind] = null; updateRouteState();
      const query = input.value.trim().toLocaleLowerCase('ko-KR');
      list.innerHTML = '';
      if (query) state.nodes.filter(node => node.name.toLocaleLowerCase('ko-KR').includes(query)).slice(0,8).forEach(node => {
        const button = document.createElement('button');button.type='button';button.textContent=node.name;
        button.onclick=()=>{setEndpoint(kind,node);list.classList.remove('active');input.setAttribute('aria-expanded','false');input.focus();};list.append(button);
      });
      list.classList.toggle('active',!!list.children.length);
      input.setAttribute('aria-expanded',String(!!list.children.length));
    });
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown' && list.children.length){event.preventDefault();list.firstElementChild.focus();}});
    list.addEventListener('keydown',event=>{
      const buttons=[...list.children],index=buttons.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(event.key==='Escape'){list.classList.remove('active');input.setAttribute('aria-expanded','false');input.focus();}
    });
  }
  async function findRoute() {
    const {start,end} = state.endpoints;
    if (!start || !end) return toast('출발지와 도착지를 선택해주세요.',true);
    const request = ++state.routeRequest;
    els.btn_search.disabled = true;
    els.btn_search.textContent = "경로 탐색 중…";
    try {
      const route = await api("/api/routes", {
        method: "POST",
        body: JSON.stringify({
          start,
          end,
          accessibleMode: els.search_wheelchair_mode.checked,
        }),
      });
      if (request !== state.routeRequest) return;
      if (state.routeLayer) map.removeLayer(state.routeLayer);
      const color = { caution: "#e11d48", good: "#059669", unknown: "#7c3aed" }[
        route.status
      ];
      state.routeLayer = L.geoJSON(route.geometry, {
        style: { color, weight: 6, opacity: 0.9 },
      }).addTo(map);
      fitVisible(state.routeLayer.getBounds());
      const title = {
        caution: "⚠ 주의 필요",
        good: "✓ 등록 정보상 양호",
        unknown: "• 정보 부족",
      }[route.status];
      const details = `거리 ${Math.round(route.distance)}m · 예상 ${Math.max(1,Math.ceil(route.duration/60))}분`;
      els.route_float.innerHTML = `<div class="context-heading"><h2>${title}</h2><button class="icon-button" id="close-route" aria-label="경로 결과 닫기" title="경로 결과 닫기">×</button></div><dl class="route-metrics"><div><dt>거리</dt><dd>${Math.round(route.distance).toLocaleString()} m</dd></div><div><dt>예상 시간</dt><dd>약 ${Math.max(1,Math.ceil(route.duration/60))}분</dd></div></dl><p class="route-line"><b>위험 구역</b><span>${route.hazards.length ? route.hazards.map(h=>text(h.name)).join(', ') : '겹치는 등록 구역 없음'}</span></p><p class="route-line"><b>주변 정보</b><span>휠체어 ${route.nearbyAccessibility.wheelchair} · 점자 ${route.nearbyAccessibility.braille} · 화장실 ${route.nearbyAccessibility.toilet}</span></p><p class="route-line"><b>참고 정보</b><span>${route.status==='unknown' ? '판단에 필요한 정보가 부족합니다.' : '등록된 데이터에 한해 검토한 결과입니다.'}</span></p><small>등록 데이터 기반 참고 경로이며 실제 이동 가능성을 보장하지 않습니다.</small><button class="button button-quiet" id="copy-route">경로 요약 복사</button>`;
      $('close-route').onclick=()=>{els.route_float.hidden=true;};
      $('copy-route').onclick=async()=>{try{await navigator.clipboard.writeText(`${start.name} → ${end.name}\n${details}\n${els.route_float.innerText.replace('경로 요약 복사','')}`);toast('경로 요약을 복사했습니다.');}catch{toast('복사를 지원하지 않는 환경입니다.',true);}};
      els.route_float.hidden = false;
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (request === state.routeRequest) { updateRouteState(); els.btn_search.textContent = "경로 찾기"; }
    }
  }
  async function importGeoJson(file) {
    const button = $("btn-import");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await BFMApi.importGeoJson(file);
      els.import_result.hidden = false;
      els.import_result.innerHTML = `<summary>가져오기 완료 · 결과 보기</summary><div>추가 ${result.created} · 갱신 ${result.updated} · 건너뜀 ${result.skipped} · 오류 ${result.errors}${result.errorDetails.length ? `<br>${result.errorDetails.map((error) => `${error.index}번: ${text(error.message)}`).join("<br>")}` : ""}</div>`;
      toast("GeoJSON 데이터를 병합했습니다.");
      await loadData();
    } catch (error) {
      els.import_result.hidden = false;
      els.import_result.innerHTML = `<summary>가져오기 실패</summary><p>${text(error.message)}</p>`;
      toast(error.message, true);
    } finally {
      button.disabled = false;
      els.import_file.value = "";
    }
  }
  async function loadData() {
    const request = ++state.dataRequest;
    try {
      const [config, nodes, polygons] = await Promise.all([
        state.tilesReady ? null : api("/api/config"),
        api("/api/nodes"),
        api("/api/polygons"),
      ]);
      if (request !== state.dataRequest) return false;
      if (!state.tilesReady) {
        const tiles = L.tileLayer(config.tileUrl, {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://routing.openstreetmap.de/about.html">FOSSGIS 경로</a> · <a href="https://www.openstreetmap.org/fixthemap">지도 수정</a>',
        });
        tiles.once("load", () => setMapStatus(""));
        tiles.on("tileerror", () =>
          setMapStatus(
            "배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침하세요.",
          ),
        );
        tiles.addTo(map);
        state.tilesReady = true;
      }
      for (const kind of ["start","end"]) {
        const old = state.endpoints[kind];
        if (old?.id) { const fresh = nodes.find(n => n.id === old.id); if (!fresh || JSON.stringify(fresh) !== JSON.stringify(old)) { clearRoute(); state.endpoints[kind] = fresh || null; els[`input_${kind}`].value = fresh?.name || ""; } }
      }
      if (JSON.stringify(state.polygons) !== JSON.stringify(polygons)) clearRoute();
      updateRouteState();
      state.nodes = nodes;
      state.polygons = polygons;
      renderAll();
    } catch (error) {
      if (request !== state.dataRequest) return false;
      toast(error.message, true);
      return false;
    }
  }
  document
    .querySelectorAll(".tab")
    .forEach((tab) => (tab.onclick = () => activate(tab.dataset.tab)));
  els.filter_category.onchange = () => {
    state.filter = els.filter_category.value;
    renderMap();
    renderList();
  };
  map.on("click", (event) => {
    if (polygonSubmit.pending) return;
    if (state.drawing) {
      if ($("tab-zone").hidden) activate("tab-zone");
      if (state.points.length >= 500) return toast("꼭짓점은 최대 500개까지 저장할 수 있습니다.", true);
      state.points.push(event.latlng);
      updateTemporary();
      return;
    }
    previewPlace(event.latlng);
  });
  els.node_form.onsubmit = async (event) => {
    event.preventDefault();
    await registrationSubmit.run(async () => {
    const submit = els.node_form.querySelector('button[type="submit"]');
    const editId = els.node_form.dataset.editId;
    const point = state.selectedLatLng;
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      $('node-save-error').textContent = '등록 위치를 확인할 수 없습니다. 창을 닫고 지도에서 위치를 다시 선택해 주세요.';
      $('node-save-error').hidden = false;
      return;
    }
    if (!els.node_name.value.trim()) {
      $('node-save-error').textContent = '장소 이름을 입력해 주세요.';
      $('node-save-error').hidden = false;
      els.node_name.focus();
      return;
    }
    const controls = [...els.node_form.querySelectorAll('input, select, textarea, button')];
    const previousDisabled = controls.map(control => control.disabled);
    submit.textContent = '저장 중…';
    els.node_form.setAttribute('aria-busy', 'true');
    $('node-save-error').hidden = true;
    let saved = false;
    try {
      const payload = {
        name: els.node_name.value.trim(),
        category: els.node_category.value,
        color: category[els.node_category.value][1],
        lat: point.lat,
        lng: point.lng,
        verificationStatus: els.verification_status.value,
        verifiedAt: els.verified_at.value || null,
        sourceNote: els.source_note.value,
        attributes: {
          wheelchair: els.attr_wheelchair.checked,
          braille: els.attr_braille.checked,
          toilet: els.attr_toilet.checked,
          image: els.node_image.value.trim(),
        },
      };
      controls.forEach(control => control.disabled = true);
      await api(editId ? `/api/nodes/${editId}` : "/api/nodes", {
        method: editId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      saved = true;
    } catch (error) {
      $('node-save-error').textContent = `저장하지 못했습니다. ${error.message} 입력한 내용은 유지되며 다시 저장할 수 있습니다.`;
      $('node-save-error').hidden = false;
      toast(error.message, true);
    } finally {
      controls.forEach((control, index) => control.disabled = previousDisabled[index]);
      submit.textContent = '저장하기';
      els.node_form.removeAttribute('aria-busy');
    }
    if (saved) {
      hideModal(els.node_modal);
      clearPreview();
      state.selectedLatLng = null;
      toast(editId ? "장소 정보를 수정했습니다." : "장소를 등록했습니다.");
      await loadData();
    }
    });
  };
  els.btn_modal_cancel.onclick = closeNode;
  els.btn_modal_secondary.onclick = closeNode;
  let modalReturnFocus = null;
  function showModal(modal) {
    modalReturnFocus = document.activeElement;
    modal.hidden = false;
    [...document.body.children].forEach(child => { if (child !== modal && !['SCRIPT','DIALOG'].includes(child.tagName)) child.inert = true; });
    modal.querySelector('input,button')?.focus();
  }
  function hideModal(modal) {
    modal.hidden = true;
    [...document.body.children].forEach(child => child.inert = false);
    if (modalReturnFocus?.isConnected && modalReturnFocus.getClientRects().length) modalReturnFocus.focus();
    else (modal === els.node_modal ? $('btn-add-place') : els.btn_info_open).focus();
  }
  function clearPreview() { if(state.preview) map.removeLayer(state.preview); state.preview=null; }
  function previewPlace(point, { openForm = false } = {}) {
    if (registrationSubmit.pending) return;
    clearPreview();
    const selectedPoint = L.latLng(point.lat, point.lng);
    state.selectedLatLng = selectedPoint;
    state.registrationOrigin = openForm ? 'toolbar' : 'map';
    state.preview=L.marker(selectedPoint,{title:'새 장소 등록 위치',icon:L.divIcon({className:'preview-pin',html:icon('plus'),iconSize:[44,44],iconAnchor:[22,44]})}).addTo(map);
    state.preview.getElement()?.setAttribute('aria-label','새 장소 등록 위치');
    const content = BFMRegistration.createRegistrationPreview({
      document,
      onConfirm: () => {
        state.selectedLatLng = selectedPoint;
        state.registrationOrigin = 'map';
        openNode();
      },
      onCancel: () => { clearPreview(); state.selectedLatLng = null; $('btn-add-place').focus(); },
    });
    L.DomEvent.disableClickPropagation(content);
    const mobile = matchMedia('(max-width:680px)').matches;
    if (mobile) setSheetSize('summary');
    state.preview.bindPopup(content, {
      minWidth:230,
      autoPanPaddingTopLeft: mobile ? [12, 84] : [448, 24],
      autoPanPaddingBottomRight: mobile ? [12, 220] : [24, 24],
    });
    if (openForm) openNode();
    else state.preview.openPopup();
  }
  $("btn-add-place").onclick = () => {
    if (state.drawing) return toast("현재 구역을 저장하거나 취소해 주세요.", true);
    previewPlace(map.getCenter(), { openForm: true });
  };
  $('btn-import').onclick=()=>els.import_file.click();
  els.polygon_name.oninput=updateDrawingState;
  els.btn_info_open.onclick=()=>showModal(els.info_modal);
  els.btn_info_close.onclick=()=>hideModal(els.info_modal);
  [els.node_modal,els.info_modal].forEach(modal=>modal.addEventListener('click',event=>{if(event.target===modal){if(modal===els.node_modal)closeNode();else hideModal(modal);}}));
  document.addEventListener('click',event=>{if(!event.target.closest('.more-menu'))closeMenus(); if(!event.target.closest('.autocomplete-wrap')){document.querySelectorAll('.autocomplete-list').forEach(list=>list.classList.remove('active'));[els.input_start,els.input_end].forEach(input=>input.setAttribute('aria-expanded','false'));}});
  document.addEventListener('keydown',event=>{
    const modal=[els.node_modal,els.info_modal].find(item=>!item.hidden);
    if(event.key==='Escape') {
      if(modal){if(modal===els.node_modal)closeNode();else hideModal(modal);}
      else {closeMenus(true);clearPreview();document.querySelectorAll('.tooltip').forEach(t=>t.hidden=true);}
    }
    if(modal && event.key==='Tab'){
      const items=[...modal.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
      if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
    }
  });
  document.querySelector('.tabs').setAttribute('role','tablist');
  const tabs=[...document.querySelectorAll('.tab')];
  tabs.forEach((tab,index)=>{
    tab.setAttribute('role','tab');tab.id=`nav-${tab.dataset.tab}`;tab.setAttribute('aria-controls',tab.dataset.tab);
    const panel=$(tab.dataset.tab);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
    tab.addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activate(tabs[target].dataset.tab);tabs[target].focus();}});
  });
  document.querySelectorAll('.map-actions button,.info-button,.swap-button').forEach((button,index)=>{
    const tooltip=document.createElement('span');tooltip.id=`tooltip-${index}`;tooltip.className='tooltip';tooltip.role='tooltip';tooltip.textContent=button.title||button.getAttribute('aria-label');tooltip.hidden=true;button.removeAttribute('title');button.setAttribute('aria-describedby',tooltip.id);button.append(tooltip);
    let timer;const show=()=>{clearTimeout(timer);tooltip.hidden=false;};const hide=()=>{timer=setTimeout(()=>tooltip.hidden=true,120);};button.addEventListener('pointerenter',show);button.addEventListener('focus',show);button.addEventListener('pointerleave',hide);button.addEventListener('blur',hide);tooltip.addEventListener('pointerenter',show);tooltip.addEventListener('pointerleave',hide);
  });
  activate('tab-search');
  els.btn_draw_polygon.onclick = () => drawMode(true);
  els.btn_undo_polygon.onclick = () => {
    state.points.pop();
    updateTemporary();
  };
  els.btn_reset_polygon.onclick = () => {
    state.points = [];
    updateTemporary();
  };
  els.btn_cancel_polygon.onclick = () => drawMode(false);
  els.btn_finish_polygon.onclick = async () => {
    if (polygonSubmit.pending) return;
    const name = els.polygon_name.value.trim();
    if (!name) return toast("위험 구역 이름을 입력해주세요.", true);
    if (state.points.length < 3)
      return toast("위험 구역은 세 지점 이상 필요합니다.", true);
    const id = state.editingPolygonId;
    try {
      await polygonSubmit.run(async () => {
        updateDrawingState();
        await api(id ? `/api/polygons/${id}` : "/api/polygons", {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            paths: state.points.map((point) => [point.lng, point.lat]),
          }),
        });
      });
      drawMode(false);
      toast(id ? "위험 구역을 수정했습니다." : "위험 구역을 등록했습니다.");
      await loadData();
    } catch (error) {
      toast(error.message, true);
    } finally {
      updateDrawingState();
    }
  };
  els.btn_global_search.onclick = searchPlace;
  els.global_search.onkeydown = (event) => {
    if (event.key === "Enter") searchPlace();
  };
  autocomplete(els.input_start, els.autocomplete_list_start);
  autocomplete(els.input_end, els.autocomplete_list_end);
  els.btn_swap_route.onclick=()=>{clearRoute();[state.endpoints.start,state.endpoints.end]=[state.endpoints.end,state.endpoints.start];[els.input_start.value,els.input_end.value]=[els.input_end.value,els.input_start.value];updateRouteState();};
  els.search_wheelchair_mode.onchange=()=>{clearRoute();updateRouteState();};
  els.btn_search.onclick=findRoute;
  els.btn_clear_path.onclick=()=>{clearRoute();state.endpoints={start:null,end:null};els.input_start.value='';els.input_end.value='';updateRouteState();};
  els.btn_my_location.onclick = () =>
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        const point = [position.coords.latitude, position.coords.longitude];
        L.circleMarker(point, {
          radius: 9,
          color: "#fff",
          weight: 3,
          fillColor: "#7c3aed",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip("내 위치")
          .openTooltip();
        fitVisible(L.latLngBounds([point,point]));
      },
      () => toast("위치 정보를 가져올 수 없습니다.", true),
    );
  els.btn_overview.onclick = () => {
    const bounds = state.markerLayer.getBounds?.();
    if (bounds?.isValid()) fitVisible(bounds);
    else map.setView([34.8916, 128.6433], 16);
  };
  els.import_file.onchange = (event) => {
    const [file] = event.target.files;
    if (file) importGeoJson(file);
  };
  els.btn_contrast.onclick = () => {
    const enabled = document.body.classList.toggle("high-contrast");
    els.btn_contrast.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("bfm-high-contrast", enabled ? "1" : "0");
  };
  if (localStorage.getItem("bfm-high-contrast") === "1") {
    document.body.classList.add("high-contrast");
    els.btn_contrast.setAttribute("aria-pressed", "true");
  }
  function setSheetSize(size) {
    els.sidebar.dataset.size = size;
    document.body.dataset.sheetSize = size;
    els.btn_sheet_toggle.setAttribute(
      "aria-expanded",
      String(size !== "summary"),
    );
  }
  setSheetSize(els.sidebar.dataset.size || "middle");
  els.btn_sheet_toggle.onclick = () => {
    const order = ["summary", "middle", "full"];
    const current = order.indexOf(els.sidebar.dataset.size || "middle");
    setSheetSize(order[(current + 1) % order.length]);
  };
  loadData();
  BFMApi.watchChanges({ refresh: loadData });
});
