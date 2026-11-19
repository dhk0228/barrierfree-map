# 배리어 프리 맵 v3.3 Sites

Windows v3.3 커밋 `4300bed`에서 분리한 Sites용 소스입니다. 배포에 사용한 Sites v3.3 소스 커밋은 `1797c1f`입니다. 지도는 `/`, 운영 콘솔은 `/control`입니다.

- `web/`은 v3.3 Leaflet 지도와 콘솔입니다. 두 페이지에서 같은 출처의 API와 D1 데이터를 사용합니다. Windows 파일 경로 대신 콘솔에서 저장 결과를 확인할 수 있습니다.
- `worker/`는 장소·위험 구역 CRUD, 콘솔 요약, GeoJSON, 보행 경로 API입니다. 탭이 보일 때 4초마다 변경 번호를 확인하고, 데이터가 바뀌면 화면을 갱신합니다. 최근 변경 정보도 D1에 저장됩니다.
- `drizzle/`은 빈 D1을 위한 초기 스키마입니다. Windows 데이터는 콘솔에서 사용자가 선택한 GeoJSON 파일을 통해 병합할 수 있습니다. 새 항목은 추가하고 같은 원본 ID는 더 최신인 항목으로 갱신합니다.
- 지도 검색은 등록 장소에 적용됩니다. 지도 타일은 OpenStreetMap을 사용하며, 보행 경로 조회는 FOSSGIS OSRM으로 요청한 뒤 등록 위험 구역과 교차하는지 확인합니다. 서비스 주소는 `BFM_TILE_URL`과 `BFM_ROUTE_URL`로 바꿀 수 있습니다. [FOSSGIS 경로 서비스](https://routing.openstreetmap.de/about.html)

Sites 배포용 파일을 조립하는 명령은 `node build.mjs`입니다. 추가 패키지 설치 없이 기존 웹 파일과 Worker 모듈을 `dist/server/`에 모읍니다. `dist/`와 배포 아카이브는 재생성 가능합니다.

이 소스의 `.openai/hosting.json`에는 D1 바인딩 설정이 들어 있습니다. 실제 배포는 해당 Sites 프로젝트의 작업 사본에서 진행합니다. 사이트에서 내려받은 GeoJSON과 운영 데이터는 별도로 관리합니다.
