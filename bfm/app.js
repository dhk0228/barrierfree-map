document.addEventListener('DOMContentLoaded', () => {
    /* =========================================================
       1. 지도 초기화 (Map Initialization)
       - Naver Maps API v3를 사용하여 중심 좌표와 줌 레벨을 설정합니다.
       ========================================================= */
    const map = new naver.maps.Map('map', {
        center: new naver.maps.LatLng(34.8916, 128.6433),
        zoom: 16,
        zoomControl: true,
        zoomControlOptions: {
            position: naver.maps.Position.BOTTOM_RIGHT
        }
    });

    /* =========================================================
       2. 전역 상태 관리 (State Management)
       - 애플리케이션의 핵심 데이터(노드 목록, 구역 목록 등)를 저장합니다.
       ========================================================= */
    const state = {
        nodeDataList: [],        // 등록된 장소 마커 데이터 배열
        polygonList: [],         // 등록된 구역(다각형) 데이터 배열
        polylines: [],           // 전체 네트워크 가상 연결선 객체 배열
        searchPolyline: null,    // 실제 탐색된 최단 경로 선 레이어
        nextId: 1,               // 새 장소 등록 시 부여될 고유 ID
        tempLatLng: null,        // 지도 클릭 시 임시로 저장되는 위경도 (naver.maps.LatLng)
        currentFilter: 'all',    // 현재 활성화된 테마별 필터 상태
        
        // 구역(Polygon) 그리기 관련 상태
        isDrawingPolygon: false, // 다각형 그리기 모드 활성화 여부
        tempPolygonPoints: [],   // 그리기 중 클릭한 좌표 배열
        tempPolygonLayer: null,  // 임시로 그려지고 있는 다각형 레이어
        
        // 내 위치
        myLocationMarker: null,
        myLocationInfo: null
    };

    /* =========================================================
       3. DOM 요소 연결 (DOM Elements)
       - HTML의 주요 요소들을 자바스크립트 변수로 매핑합니다.
       ========================================================= */
    const elements = {
        coordList: document.getElementById('coord-list'),
        modalOverlay: document.getElementById('modal-overlay'),
        nodeNameInput: document.getElementById('node-name'),
        nodeCategorySelect: document.getElementById('node-category'),
        nodeImageInput: document.getElementById('node-image'),
        filterSelect: document.getElementById('filter-category'),
        
        attrWheelchair: document.getElementById('attr-wheelchair'),
        attrBraille: document.getElementById('attr-braille'),
        attrToilet: document.getElementById('attr-toilet'),
        searchWheelchairMode: document.getElementById('search-wheelchair-mode'),

        tabs: document.querySelectorAll('.tab'),
        tabContents: document.querySelectorAll('.tab-content'),
        statsContainer: document.getElementById('stats-container'),
        btnModalCancel: document.getElementById('btn-modal-cancel'),
        btnModalSave: document.getElementById('btn-modal-save'),
        btnSearch: document.getElementById('btn-search'),
        btnClearPath: document.getElementById('btn-clear-path'),
        inputStart: document.getElementById('input-start'),
        inputEnd: document.getElementById('input-end'),
        routeSummary: document.getElementById('route-summary'),
        
        btnDrawAll: document.getElementById('btn-draw-all'),
        btnExport: document.getElementById('btn-export'),
        
        btnMyLocation: document.getElementById('btn-my-location'),
        globalSearch: document.getElementById('global-search'),
        
        btnDrawPolygon: document.getElementById('btn-draw-polygon'),
        btnFinishPolygon: document.getElementById('btn-finish-polygon'),
        polygonHint: document.getElementById('polygon-hint'),
        polygonListContainer: document.getElementById('polygon-list-container'),
        
        infoModalOverlay: document.getElementById('info-modal-overlay'),
        btnInfoOpen: document.getElementById('btn-info-open'),
        btnInfoClose: document.getElementById('btn-info-close'),
        autocompleteListStart: document.getElementById('autocomplete-list-start'),
        autocompleteListEnd: document.getElementById('autocomplete-list-end')
    };
    
    /* =========================================================
       전역 함수 (Global Functions)
       - 마커 팝업 내부의 버튼에서 직접 접근할 수 있도록 window 객체에 할당합니다.
       ========================================================= */
    window.setRoutePoint = (type, nodeName) => {
        if (type === 'start') {
            elements.inputStart.value = nodeName;
        } else {
            elements.inputEnd.value = nodeName;
        }
        
        // 검색 탭으로 전환
        elements.tabs.forEach(t => {
            if (t.getAttribute('data-tab') === 'tab-search') {
                t.click();
            }
        });
        
        // 열려있는 모든 InfoWindow 닫기
        state.nodeDataList.forEach(n => {
            if (n.infoWindow && n.infoWindow.getMap()) {
                n.infoWindow.close();
            }
        });
    };

    /* =========================================================
       4. 유틸리티 함수 (Utility Functions)
       - 아이콘 생성, 거리 계산 등 재사용 가능한 공통 함수들입니다.
       ========================================================= */
    const utils = {
        createSvgIcon(category, color) {
            let svgString = '';
            if (category === 'obstacle') {
                svgString = `
                <svg class="marker-pin obstacle-pin" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="${color}"/>
                </svg>`;
            } else if (category === 'building') {
                svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z" fill="${color}"/>
                    <path d="M12 4L6 9v7h4v-4h4v4h4V9l-6-5z" fill="#fff"/>
                </svg>`;
            } else if (category === 'elevator') {
                 svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z" fill="${color}"/>
                    <path d="M10 5l-3 3h2v8H7l3 3 3-3h-2V8h2l-3-3zm7 6h-2v5h2v-5z" fill="#fff"/>
                </svg>`;
            } else if (category === 'toilet') {
                 svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z" fill="${color}"/>
                    <circle cx="9" cy="6.5" r="1.5" fill="#fff"/><path d="M11 9.5H7v7h1.5v3h1v-3H11v-7z" fill="#fff"/>
                    <circle cx="15" cy="6.5" r="1.5" fill="#fff"/><path d="M16 9.5h-2l-1 5h1v5h2v-5h1l-1-5z" fill="#fff"/>
                </svg>`;
            } else if (category === 'transport') {
                 svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z" fill="${color}"/>
                    <path d="M15 5H9c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h1v1h4v-1h1c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-4.5 9.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3-5H9V7h4.5v2.5z" fill="#fff"/>
                </svg>`;
            } else if (category === 'ramp') {
                 svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12z" fill="${color}"/>
                    <path d="M6 14l9-5v2l-7 4v2h7v2H6v-5z" fill="#fff"/>
                </svg>`;
            } else { // other
                svgString = `
                <svg class="marker-pin" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24c0-6.63-5.37-12-12-12zm0 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="${color}"/>
                </svg>`;
            }
            
            // 네이버 지도 아이콘 포맷으로 반환
            return {
                content: svgString,
                size: category === 'obstacle' ? new naver.maps.Size(32, 32) : new naver.maps.Size(28, 36),
                anchor: category === 'obstacle' ? new naver.maps.Point(16, 32) : new naver.maps.Point(14, 36)
            };
        },
        getCategoryLabel(val) {
            const labels = {
                'building': '건축물', 'ramp': '경사로', 'elevator': '엘리베이터',
                'transport': '교통', 'toilet': '화장실', 'obstacle': '장애물', 'other': '기타'
            };
            return labels[val] || '기타';
        },
        
        // 두 위경도 좌표 간의 직선 거리를 하버사인(Haversine) 공식으로 계산 (단위: 미터)
        calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371e3; 
            const φ1 = lat1 * Math.PI/180;
            const φ2 = lat2 * Math.PI/180;
            const Δφ = (lat2-lat1) * Math.PI/180;
            const Δλ = (lon2-lon1) * Math.PI/180;
            const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                    Math.cos(φ1) * Math.cos(φ2) *
                    Math.sin(Δλ/2) * Math.sin(Δλ/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c; 
        }
    };

    /* =========================================================
       네트워크 그래프 시각화 엔진 (Routing Graph Engine)
       - 전체 네트워크 보기(300m 이내 노드 연결)용 가상 그래프를 생성합니다.
       ========================================================= */
    const routing = {
        buildGraph(nodes, wheelchairMode) {
            const graph = {};
            nodes.forEach(n => graph[n.id] = {});
            
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const n1 = nodes[i];
                    const n2 = nodes[j];
                    
                    if (wheelchairMode) {
                        if (n1.category === 'obstacle' || n2.category === 'obstacle') continue;
                        if (!n1.attributes.wheelchair || !n2.attributes.wheelchair) continue;
                    }

                    const dist = utils.calculateDistance(n1.lat, n1.lng, n2.lat, n2.lng);
                    if (dist < 300) { 
                        graph[n1.id][n2.id] = dist;
                        graph[n2.id][n1.id] = dist;
                    }
                }
            }
            return graph;
        }
    };

    /* =========================================================
       5. UI 렌더링 및 상태 업데이트 (UI Rendering & Actions)
       - 탭 전환, 통계 갱신, 리스트 출력 등 화면의 변화를 담당합니다.
       ========================================================= */
    const ui = {
        initTabs() {
            elements.tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    elements.tabs.forEach(t => t.classList.remove('active'));
                    elements.tabContents.forEach(tc => tc.classList.remove('active'));
                    
                    tab.classList.add('active');
                    const targetId = tab.getAttribute('data-tab');
                    document.getElementById(targetId).classList.add('active');
                });
            });
        },
        
        updateStats() {
            if (state.nodeDataList.length === 0) {
                elements.statsContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 14px; padding: 30px 0;">데이터가 없습니다.</div>';
                return;
            }
            const counts = { building: 0, ramp: 0, elevator: 0, transport: 0, toilet: 0, obstacle: 0, other: 0 };
            state.nodeDataList.forEach(n => {
                if(counts[n.category] !== undefined) counts[n.category]++;
            });
            
            let html = `<div class="stats-total">총 등록된 장소: ${state.nodeDataList.length}개</div><ul class="stats-list">`;
            html += `<li><span>🏢 건축물</span><span>${counts.building}개</span></li>`;
            html += `<li><span>♿ 경사로/진입로</span><span>${counts.ramp}개</span></li>`;
            html += `<li><span>↕️ 엘리베이터</span><span>${counts.elevator}개</span></li>`;
            html += `<li><span>🚌 정류장/교통</span><span>${counts.transport}개</span></li>`;
            html += `<li><span>🚻 장애인 화장실</span><span>${counts.toilet}개</span></li>`;
            html += `<li><span>⚠️ 장애물/주의</span><span>${counts.obstacle}개</span></li>`;
            html += `<li><span>기타</span><span>${counts.other}개</span></li>`;
            html += `</ul>`;
            elements.statsContainer.innerHTML = html;
        },
        
        renderList() {
            const filteredNodes = state.currentFilter === 'all' 
                ? state.nodeDataList 
                : state.nodeDataList.filter(n => n.category === state.currentFilter);

            if (filteredNodes.length === 0) {
                elements.coordList.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 14px; margin-top: 30px;">조건에 맞는 장소가 없습니다.</div>';
                return;
            }

            elements.coordList.innerHTML = '';
            filteredNodes.forEach(node => {
                const item = document.createElement('div');
                item.className = 'coord-item';
                
                let attrsHtml = '';
                if(node.attributes.wheelchair) attrsHtml += '♿ ';
                if(node.attributes.braille) attrsHtml += '⠃ ';
                if(node.attributes.toilet) attrsHtml += '🚻 ';

                const infoDiv = document.createElement('div');
                infoDiv.className = 'coord-info';
                infoDiv.innerHTML = `
                    <div class="coord-name">
                        ${node.name}
                        <span class="badge" style="background-color: ${node.color}">${utils.getCategoryLabel(node.category)}</span>
                        ${attrsHtml ? `<span style="font-size:12px; color:var(--primary);">${attrsHtml}</span>` : ''}
                    </div>
                    <span class="coord-latlng">ID: ${node.id} &nbsp;|&nbsp; ${node.lat}, ${node.lng}</span>
                `;
                
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-delete';
                delBtn.innerHTML = `삭제`;
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    mapActions.deleteNode(node.id);
                };

                item.appendChild(infoDiv);
                item.appendChild(delBtn);
                
                item.onclick = () => {
                    map.morph(new naver.maps.LatLng(node.lat, node.lng), 18);
                    
                    if (node.infoWindow && !node.infoWindow.getMap()) {
                        node.infoWindow.open(map, node.marker);
                    }
                    
                    node.marker.setAnimation(naver.maps.Animation.BOUNCE);
                    setTimeout(() => {
                        node.marker.setAnimation(null);
                    }, 2500);
                };
                
                elements.coordList.appendChild(item);
            });
            elements.coordList.scrollTop = elements.coordList.scrollHeight;
        },
        
        renderPolygonList() {
            if (state.polygonList.length === 0) {
                elements.polygonListContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 14px; margin-top: 20px;">등록된 구역이 없습니다.</div>';
                return;
            }
            elements.polygonListContainer.innerHTML = '';
            state.polygonList.forEach(p => {
                const item = document.createElement('div');
                item.className = 'coord-item';
                item.style.marginBottom = '8px';
                item.style.padding = '12px 16px';
                
                item.innerHTML = `
                    <div class="coord-info">
                        <div class="coord-name" style="font-size:14px; color:#ef4444;">🚧 ${p.name}</div>
                    </div>
                `;
                
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-delete';
                delBtn.innerHTML = `삭제`;
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    p.layer.setMap(null);
                    state.polygonList = state.polygonList.filter(poly => poly.id !== p.id);
                    ui.renderPolygonList();
                };
                
                item.appendChild(delBtn);
                
                item.onclick = () => {
                    const paths = p.layer.getPaths().getAt(0);
                    if (paths && paths.getLength() > 0) {
                        const bounds = new naver.maps.LatLngBounds();
                        const pathsArr = paths.getArray();
                        pathsArr.forEach(coord => bounds.extend(coord));
                        map.fitBounds(bounds, { margin: 50 });
                    }
                    
                    p.layer.setOptions({ strokeColor: '#facc15', fillColor: '#facc15', fillOpacity: 0.8 });
                    setTimeout(() => {
                        p.layer.setOptions({ strokeColor: 'red', fillColor: '#ef4444', fillOpacity: 0.4 });
                    }, 2500);
                };
                
                elements.polygonListContainer.appendChild(item);
            });
        }
    };

    /* =========================================================
       6. 지도 및 노드 제어 (Map Actions)
       ========================================================= */
    const mapActions = {
        drawAllPaths() {
            this.clearPaths();
            if (state.nodeDataList.length < 2) return;
            const graph = routing.buildGraph(state.nodeDataList, false);
            
            // 네이버 지도의 경우 다수의 독립된 선분을 그리기 위해 배열을 사용합니다.
            state.polylines = [];
            for (let fromId in graph) {
                for (let toId in graph[fromId]) {
                    if (fromId < toId) { 
                        const n1 = state.nodeDataList.find(n => n.id == fromId);
                        const n2 = state.nodeDataList.find(n => n.id == toId);
                        
                        const line = new naver.maps.Polyline({
                            map: map,
                            path: [
                                new naver.maps.LatLng(n1.lat, n1.lng),
                                new naver.maps.LatLng(n2.lat, n2.lng)
                            ],
                            strokeColor: '#94a3b8',
                            strokeWeight: 2,
                            strokeOpacity: 0.4,
                            strokeStyle: 'shortdash',
                            strokeLineCap: 'round'
                        });
                        state.polylines.push(line);
                    }
                }
            }
        },
        clearPaths() {
            if (state.polylines && state.polylines.length > 0) {
                state.polylines.forEach(p => p.setMap(null));
                state.polylines = [];
            }
            if (state.searchPolyline) { 
                state.searchPolyline.setMap(null); 
                state.searchPolyline = null; 
            }
            elements.routeSummary.style.display = 'none';
        },
        deleteNode(id) {
            const nodeIndex = state.nodeDataList.findIndex(n => n.id === id);
            if (nodeIndex > -1) {
                const node = state.nodeDataList[nodeIndex];
                if (node.marker) node.marker.setMap(null);
                if (node.infoWindow) node.infoWindow.close();
                
                state.nodeDataList.splice(nodeIndex, 1);
                ui.renderList();
                ui.updateStats();
                if (state.polylines && state.polylines.length > 0) this.drawAllPaths();
                this.clearPaths();
            }
        }
    };

    function updateMarkerVisibility() {
        const currentZoom = map.getZoom();
        const shouldBeVisible = currentZoom >= 16;
        state.nodeDataList.forEach(node => {
            const matchesFilter = state.currentFilter === 'all' || node.category === state.currentFilter;
            if (shouldBeVisible && matchesFilter) {
                if (!node.marker.getMap()) node.marker.setMap(map);
            } else {
                if (node.marker.getMap()) {
                    node.marker.setMap(null);
                    if (node.infoWindow && node.infoWindow.getMap()) node.infoWindow.close();
                }
            }
        });
    }

    /* =========================================================
       7. 이벤트 리스너 바인딩 (Event Listeners)
       ========================================================= */
    naver.maps.Event.addListener(map, 'zoom_changed', updateMarkerVisibility);

    naver.maps.Event.addListener(map, 'click', (e) => {
        if (state.isDrawingPolygon) {
            state.tempPolygonPoints.push(e.coord);
            if (state.tempPolygonLayer) {
                state.tempPolygonLayer.setMap(null);
            }
            state.tempPolygonLayer = new naver.maps.Polygon({
                map: map,
                paths: state.tempPolygonPoints,
                strokeColor: 'red',
                fillColor: '#ef4444',
                fillOpacity: 0.4
            });
            return;
        }

        state.tempLatLng = e.coord; // naver.maps.LatLng
        elements.nodeNameInput.value = '';
        elements.nodeImageInput.value = '';
        elements.attrWheelchair.checked = true; 
        elements.attrBraille.checked = false;
        elements.attrToilet.checked = false;
        elements.modalOverlay.classList.add('active');
        setTimeout(() => elements.nodeNameInput.focus(), 50);
    });

    elements.btnModalCancel.addEventListener('click', () => {
        elements.modalOverlay.classList.remove('active');
        state.tempLatLng = null;
    });

    function createMarkerAndPopup(dbNode) {
        const customIcon = utils.createSvgIcon(dbNode.category, dbNode.color);
        
        const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(dbNode.lat, dbNode.lng),
            icon: customIcon
        });
        
        let attrsLabels = [];
        if(dbNode.attributes.wheelchair) attrsLabels.push('휠체어♿');
        if(dbNode.attributes.braille) attrsLabels.push('점자⠃');
        if(dbNode.attributes.toilet) attrsLabels.push('화장실🚻');
        
        let popupHtml = `<div style="padding:4px; min-width: 150px;">`;
        if (dbNode.attributes.image) {
            popupHtml += `<img src="${dbNode.attributes.image}" style="width:100%; border-radius:12px; margin-bottom:8px; object-fit:cover;" onerror="this.style.display='none'">`;
        }
        popupHtml += `<b style="font-size: 15px; color: #1e293b;">${dbNode.name}</b><br>
            <span style="display:inline-block; margin-top:6px; padding: 4px 10px; border-radius:9999px; background-color:${dbNode.color}; color:white; font-weight:600; font-size: 11px;">
                ${utils.getCategoryLabel(dbNode.category)}
            </span>
            ${attrsLabels.length > 0 ? `<div style="margin-top:8px; font-size:12px; color:var(--text-sub);">${attrsLabels.join(' | ')}</div>` : ''}
            <div class="popup-btn-group">
                <button class="popup-btn" onclick="window.setRoutePoint('start', '${dbNode.name}')">출발지로 설정</button>
                <button class="popup-btn" onclick="window.setRoutePoint('end', '${dbNode.name}')">도착지로 설정</button>
            </div>
        </div>`;

        const infoWindow = new naver.maps.InfoWindow({
            content: popupHtml,
            maxWidth: 220,
            backgroundColor: "#ffffff",
            borderColor: "rgba(226, 232, 240, 0.8)",
            borderWidth: 1,
            anchorSize: new naver.maps.Size(10, 10)
        });
        
        naver.maps.Event.addListener(marker, 'click', () => {
            if (infoWindow.getMap()) {
                infoWindow.close();
            } else {
                infoWindow.open(map, marker);
            }
        });
        
        const currentZoom = map.getZoom();
        if (currentZoom >= 16 && (state.currentFilter === 'all' || dbNode.category === state.currentFilter)) {
            marker.setMap(map);
        }
        
        return { marker, infoWindow };
    }

    elements.btnModalSave.addEventListener('click', () => {
        const nameVal = elements.nodeNameInput.value.trim();
        const nodeName = nameVal === "" ? `임시 노드 ${state.nextId}` : nameVal;
        const categoryVal = elements.nodeCategorySelect.value;
        const selectedOption = elements.nodeCategorySelect.options[elements.nodeCategorySelect.selectedIndex];
        const markerColor = selectedOption.getAttribute('data-color');
        const imageUrl = elements.nodeImageInput.value.trim();
        
        const attrs = {
            wheelchair: elements.attrWheelchair.checked,
            braille: elements.attrBraille.checked,
            toilet: elements.attrToilet.checked,
            image: imageUrl
        };
        
        const lat = state.tempLatLng.lat();
        const lng = state.tempLatLng.lng();
        
        // 서버로 노드 데이터 전송 (POST API 연동)
        fetch('/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nodeName,
                category: categoryVal,
                color: markerColor,
                attributes: attrs,
                lat: lat,
                lng: lng
            })
        })
        .then(res => res.json())
        .then(json => {
            if (json.error) {
                alert('노드 생성 실패: ' + json.error);
                return;
            }
            
            const dbNode = json.data;
            const { marker, infoWindow } = createMarkerAndPopup(dbNode);
            
            const nodeObj = { 
                id: dbNode.id, 
                name: dbNode.name, 
                category: dbNode.category,
                color: dbNode.color,
                attributes: dbNode.attributes,
                lat: dbNode.lat, 
                lng: dbNode.lng, 
                marker: marker,
                infoWindow: infoWindow
            };
            
            state.nodeDataList.push(nodeObj);
            ui.renderList();
            ui.updateStats();
            if (state.polylines && state.polylines.length > 0) mapActions.drawAllPaths();
            
            elements.modalOverlay.classList.remove('active');
            state.tempLatLng = null;
        })
        .catch(err => {
            console.error('Failed to save node:', err);
            alert('서버와의 통신에 실패했습니다.');
        });
    });

    elements.filterSelect.addEventListener('change', (e) => {
        state.currentFilter = e.target.value;
        ui.renderList();
        updateMarkerVisibility();
    });

    elements.btnSearch.addEventListener('click', () => {
        const startVal = elements.inputStart.value.trim();
        const endVal = elements.inputEnd.value.trim();
        const isWheelchairMode = elements.searchWheelchairMode.checked;

        if (!startVal || !endVal) {
            alert('출발지와 도착지 이름을 모두 입력해주세요.');
            return;
        }

        const startNode = state.nodeDataList.find(n => n.name === startVal) || state.nodeDataList.find(n => n.name.includes(startVal));
        const endNode = state.nodeDataList.find(n => n.name === endVal) || state.nodeDataList.find(n => n.name.includes(endVal));

        if (!startNode) { alert(`'${startVal}' 장소를 찾을 수 없습니다.`); return; }
        if (!endNode) { alert(`'${endVal}' 장소를 찾을 수 없습니다.`); return; }

        mapActions.clearPaths();
        
        elements.btnSearch.innerText = "경로 탐색 중...";
        elements.btnSearch.disabled = true;

        fetch(`https://router.project-osrm.org/route/v1/foot/${startNode.lng},${startNode.lat};${endNode.lng},${endNode.lat}?overview=full&geometries=geojson`)
            .then(res => res.json())
            .then(data => {
                elements.btnSearch.innerText = "출발 ➡️ 도착 경로 찾기";
                elements.btnSearch.disabled = false;
                
                if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                    alert('두 지점 간의 경로를 찾을 수 없습니다.');
                    return;
                }

                const route = data.routes[0];
                const totalDistance = route.distance;
                
                // GeoJSON (lng, lat) -> Naver LatLng (lat, lng)
                const pathCoords = route.geometry.coordinates.map(c => new naver.maps.LatLng(c[1], c[0]));

                state.searchPolyline = new naver.maps.Polyline({
                    map: map,
                    path: pathCoords,
                    strokeColor: isWheelchairMode ? '#10b981' : '#a855f7', 
                    strokeWeight: 6, 
                    strokeOpacity: 0.9,
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round'
                });

                const bounds = new naver.maps.LatLngBounds();
                pathCoords.forEach(coord => bounds.extend(coord));
                map.fitBounds(bounds, { margin: 80 });
                
                if (!startNode.marker.getMap()) startNode.marker.setMap(map);
                if (!endNode.marker.getMap()) endNode.marker.setMap(map);
                
                startNode.infoWindow.open(map, startNode.marker);
                setTimeout(() => { endNode.infoWindow.open(map, endNode.marker); }, 1200);

                const timeMinutes = Math.max(1, Math.ceil(totalDistance / 60)); 
                elements.routeSummary.innerHTML = `
                    📍 <b>${startNode.name}</b>에서 <b>${endNode.name}</b>까지 이동합니다.<br><br>
                    🚶‍♂️ 총 이동 거리: <b>${Math.round(totalDistance)}m</b><br>
                    ⏱️ 예상 소요 시간: <b>약 ${timeMinutes}분</b>
                `;
                elements.routeSummary.style.display = 'block';
            })
            .catch(err => {
                elements.btnSearch.innerText = "출발 ➡️ 도착 경로 찾기";
                elements.btnSearch.disabled = false;
                alert("경로 탐색 중 오류가 발생했습니다.");
            });
    });

    elements.btnDrawAll.addEventListener('click', () => {
        if (state.nodeDataList.length < 2) {
            alert('경로를 그리려면 최소 2개의 노드가 필요합니다.');
            return;
        }
        mapActions.drawAllPaths();
    });
    
    elements.btnClearPath.addEventListener('click', () => mapActions.clearPaths());

    /* =========================================================
       구역 그리기 제어 (Polygon Actions)
       ========================================================= */
    elements.btnDrawPolygon.addEventListener('click', () => {
        state.isDrawingPolygon = true;
        state.tempPolygonPoints = [];
        elements.btnDrawPolygon.style.display = 'none';
        elements.btnFinishPolygon.style.display = 'block';
        elements.polygonHint.style.display = 'block';
    });

    elements.btnFinishPolygon.addEventListener('click', () => {
        if (state.tempPolygonPoints.length > 2) {
            const pName = prompt('설정할 구역의 이름을 입력하세요.', '위험/공사 구역') || '이름 없는 구역';
            const polyObj = {
                id: Date.now(),
                name: pName,
                layer: state.tempPolygonLayer
            };
            state.polygonList.push(polyObj);
            ui.renderPolygonList();
        } else if (state.tempPolygonLayer) {
            state.tempPolygonLayer.setMap(null);
        }
        state.isDrawingPolygon = false;
        state.tempPolygonLayer = null;
        state.tempPolygonPoints = [];
        
        elements.btnDrawPolygon.style.display = 'block';
        elements.btnFinishPolygon.style.display = 'none';
        elements.polygonHint.style.display = 'none';
    });

    /* =========================================================
       위치 정보 및 지오코딩 (Geolocation & Geocoding)
       ========================================================= */
    elements.btnMyLocation.addEventListener('click', () => {
        if ("geolocation" in navigator) {
            elements.btnMyLocation.innerText = '⏳';
            navigator.geolocation.getCurrentPosition(position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const loc = new naver.maps.LatLng(lat, lng);
                
                map.morph(loc, 16);
                
                if (state.myLocationMarker) state.myLocationMarker.setMap(null);
                
                state.myLocationMarker = new naver.maps.Marker({
                    position: loc,
                    map: map,
                    icon: {
                        content: `<div style="width:16px;height:16px;background:#a855f7;border:3px solid #f3e8ff;border-radius:50%;box-shadow:0 0 5px rgba(0,0,0,0.3);"></div>`,
                        anchor: new naver.maps.Point(8, 8)
                    }
                });
                
                if (state.myLocationInfo) state.myLocationInfo.close();
                state.myLocationInfo = new naver.maps.InfoWindow({
                    content: '<div style="padding:4px 8px; font-size:12px; font-weight:bold;">내 위치</div>',
                    borderWidth: 0,
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    anchorSize: new naver.maps.Size(8, 8)
                });
                state.myLocationInfo.open(map, state.myLocationMarker);
                
                elements.btnMyLocation.innerText = '📍';
            }, () => {
                alert("위치 정보를 가져올 수 없습니다.");
                elements.btnMyLocation.innerText = '📍';
            });
        } else {
            alert("이 브라우저에서는 위치 기능을 지원하지 않습니다.");
        }
    });

    elements.globalSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = elements.globalSearch.value.trim();
            if (!query) return;
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
                .then(res => res.json())
                .then(data => {
                    if (data && data.length > 0) {
                        const lat = parseFloat(data[0].lat);
                        const lon = parseFloat(data[0].lon);
                        map.morph(new naver.maps.LatLng(lat, lon), 16);
                    } else {
                        alert("검색 결과를 찾을 수 없습니다.");
                    }
                })
                .catch(err => {
                    alert("검색 중 오류가 발생했습니다.");
                });
        }
    });

    elements.btnExport.addEventListener('click', () => {
        if (state.nodeDataList.length === 0) {
            alert('수집된 노드가 없습니다.');
            return;
        }
        const exportData = state.nodeDataList.map(n => ({ 
            id: n.id, name: n.name, category: n.category, attributes: n.attributes, color: n.color, lat: n.lat, lng: n.lng 
        }));
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const anchor = document.createElement('a');
        anchor.setAttribute("href", dataStr);
        anchor.setAttribute("download", "barrier_free_nodes.json");
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    });

    /* =========================================================
       안내 모달 및 자동완성 이벤트 (Info Modal & Autocomplete)
       ========================================================= */
    elements.btnInfoOpen.addEventListener('click', () => {
        elements.infoModalOverlay.classList.add('active');
    });
    elements.btnInfoClose.addEventListener('click', () => {
        elements.infoModalOverlay.classList.remove('active');
    });
    
    const handleAutocomplete = (inputElement, listElement) => {
        inputElement.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            listElement.innerHTML = '';
            if (!val) {
                listElement.classList.remove('active');
                return;
            }
            const matches = state.nodeDataList.filter(n => n.name.toLowerCase().includes(val));
            if (matches.length > 0) {
                matches.forEach(node => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerText = node.name;
                    item.addEventListener('click', () => {
                        inputElement.value = node.name;
                        listElement.classList.remove('active');
                    });
                    listElement.appendChild(item);
                });
                listElement.classList.add('active');
            } else {
                listElement.classList.remove('active');
            }
        });
        
        document.addEventListener('click', (e) => {
            if (e.target !== inputElement && e.target !== listElement) {
                listElement.classList.remove('active');
            }
        });
    };
    
    handleAutocomplete(elements.inputStart, elements.autocompleteListStart);
    handleAutocomplete(elements.inputEnd, elements.autocompleteListEnd);

    /* =========================================================
       초기화 완료 (Initialize)
       ========================================================= */
    ui.initTabs();
    
    // 애플리케이션 시작 시 백엔드 DB에서 기존 데이터 불러오기 (GET API 연동)
    fetch('/api/nodes')
        .then(res => res.json())
        .then(json => {
            if (json.data && json.data.length > 0) {
                json.data.forEach(dbNode => {
                    const { marker, infoWindow } = createMarkerAndPopup(dbNode);
                    
                    const nodeObj = { 
                        id: dbNode.id, 
                        name: dbNode.name, 
                        category: dbNode.category,
                        color: dbNode.color,
                        attributes: dbNode.attributes,
                        lat: dbNode.lat, 
                        lng: dbNode.lng, 
                        marker: marker,
                        infoWindow: infoWindow
                    };
                    
                    state.nodeDataList.push(nodeObj);
                });
                
                ui.renderList();
                ui.updateStats();
                
                // nextId 동기화 (가장 큰 id + 1)
                const maxId = Math.max(...state.nodeDataList.map(n => n.id));
                state.nextId = maxId + 1;
            }
        })
        .catch(err => {
            console.error('Failed to load nodes from server:', err);
        });
});
