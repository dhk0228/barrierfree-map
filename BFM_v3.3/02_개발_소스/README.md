# 배리어 프리 맵 v3.3.0

로컬 v3.2.0을 바탕으로 Windows 운영 콘솔과 웹 지도를 정리한 버전입니다. Electron이 콘솔을 먼저 띄우고, 콘솔과 기본 브라우저의 지도는 같은 로컬 서버와 SQLite DB를 사용합니다.

## v3.2에서 달라진 시연 흐름

| 기존 기능과 확인한 지점 | v3.3 변경 |
| --- | --- |
| 콘솔 우선 실행, 웹 지도 열기, 장소·구역 집계, SSE가 이미 있음 | 콘솔 상단에 이번 실행의 최근 변경 항목 이름·동작·시각을 표시합니다. 수정 시 장소·구역 수가 같아도 무엇이 바뀌었는지 확인할 수 있습니다. |
| 지도에서 장소를 등록·수정할 수 있음. 위험 구역은 수정 API만 있고 화면에서는 추가·삭제만 가능 | 지도에서 위험 구역 이름과 경계를 수정할 수 있습니다. |
| 지정한 v3.2 검증 폴더에도 v3.1 데이터가 최초 복사될 수 있음 | 명시적으로 지정한 폴더는 이전 버전을 조회하지 않으며, 첫 실행 시 빈 DB를 생성합니다. |
| GeoJSON은 현재 DB에 병합되며, SQLite 시각 형식과 Windows 로컬 시간 해석이 섞일 수 있음 | UTC로 통일해 비교하고 결과에 추가·갱신·건너뜀·오류 수를 표시합니다. |

## Windows 시연

Windows PowerShell에서 이 README가 있는 폴더로 이동해 잠금 파일 기준으로 의존성을 설치합니다. Windows x64와 Node.js 24 LTS는 v3.2에서 제시한 재현 기준입니다. 지도 배경 타일, 주소 검색, 경로 검색은 인터넷에 연결되어 있어야 합니다.

```powershell
npm.cmd ci
$demoRoot = Join-Path (Split-Path (Get-Location).Path -Parent) '04_디버그_빌드'
$previousBfmDataHome = $env:BFM_DATA_HOME
$env:BFM_DATA_HOME = Join-Path $demoRoot 'demo-source'
npm.cmd run desktop
```

1. 콘솔이 먼저 열리면 `로컬 데이터`의 DB 경로에 `demo-source`가 표시되는지 확인합니다. 처음 쓰는 폴더에서는 장소와 위험 구역이 각각 0개입니다.
2. `웹 지도 열기`를 누릅니다. 지도에서 위치를 선택해 `이 위치에 등록`을 누르거나 지도 도구의 `장소 등록`을 누릅니다. 예를 들어 `시연 경사로`를 저장합니다. 콘솔에서 **등록 장소 1**, **장소 등록 · 시연 경사로**를 확인합니다.
3. 지도에서 해당 장소의 `장소 수정`으로 이름을 `시연 경사로 수정`으로 바꿉니다. 콘솔의 등록 장소 수는 1이고 최근 변경에는 **장소 수정 · 시연 경사로 수정**이 표시됩니다.
4. 지도 `위험 구역` 탭에서 `구역 그리기 시작`을 누르고 지도에 점을 3개 이상 찍은 뒤 `시연 공사 구역`으로 저장합니다. 목록의 더보기 메뉴에서 `위험 구역 수정`을 누릅니다. 이름을 바꾸거나 `경계 다시 그리기`로 점을 새로 찍고 `수정 저장`을 누릅니다. 지도와 콘솔의 위험 구역 이름·개수 및 최근 변경을 확인합니다.
5. 콘솔 창을 닫고 같은 PowerShell에서 `npm.cmd run desktop`을 다시 실행합니다. 콘솔 집계와 최근 갱신 목록, 새로 연 지도에서 마지막 저장 결과를 확인합니다. `최근 변경`의 이벤트 표시는 앱 실행마다 새로 시작합니다.
6. 콘솔에서 `GeoJSON 내보내기`를 눌러 파일을 저장한 뒤 콘솔 창을 닫습니다. 같은 PowerShell에서 아래 명령으로 별도 DB를 엽니다.

```powershell
$env:BFM_DATA_HOME = Join-Path $demoRoot 'demo-import'
npm.cmd run desktop
```

7. 콘솔의 DB 경로에 `demo-import`가 표시되고 집계가 0인지 확인합니다. `GeoJSON 가져오기 · 병합`에서 6단계 파일을 선택합니다. 2~4단계에서 각각 하나씩 등록했다면 **추가 2 · 갱신 0 · 건너뜀 0 · 오류 0**이 표시됩니다. `웹 지도 열기`에서 두 항목의 최종 이름과 구역 경계를 확인합니다. 같은 파일을 다시 선택하면 **건너뜀 2**가 표시됩니다.
8. 콘솔을 닫은 뒤 `$env:BFM_DATA_HOME = $previousBfmDataHome`으로 PowerShell의 기존 설정을 복원합니다. 시연을 처음부터 다시 할 때는 새로운 이름의 검증 폴더 두 개를 지정합니다.

두 검증 DB는 각각 지정한 폴더의 `data\barrier-free-map-v3.3.sqlite`에 저장됩니다. 기본 Windows 실행은 `%APPDATA%\barrier-free-map-v3.3\data\barrier-free-map-v3.3.sqlite`를 사용합니다. 기본 경로의 첫 실행에서는 v3.2 DB가 있으면 읽기 전용 스냅샷을 만들고, v3.2 DB가 없으면 v3.1 DB를 확인합니다. 브라우저 개발용 `npm.cmd start`에도 같은 DB 경로 설정이 적용됩니다. 데스크톱 앱이 켜져 있을 때는 콘솔의 `웹 지도 열기`로 같은 서버에 접속합니다.

GeoJSON 병합은 장소(Point)와 위험 구역(Polygon)을 지원합니다. 새 항목을 추가하고, 같은 `originId`는 파일의 수정 시각이 더 최신일 때만 갱신합니다. ID가 없는 구형 항목은 이름·분류·위치 또는 이름·경계가 일치하면 건너뜁니다. 파일에 없는 기존 항목은 그대로 남습니다. 가져오기는 요청 본문 2MB, 최대 5,000개 항목을 지원합니다.

정적 확인 범위는 JavaScript 구문, HTML 참조, 패키지·잠금 파일 및 배포 포함 목록, 변경·저장·병합 코드 경로입니다. 실제 Windows 구동, 자동 테스트 및 새 EXE 빌드는 별도로 검증합니다. 추후 `npm.cmd run dist:win`의 산출물은 v3.3의 `04_디버그_빌드/release`에 생성됩니다.

## Sites 이식 시 가져갈 부분

| 영역 | 현재 파일 | Sites에서 연결할 부분 |
| --- | --- | --- |
| 웹 지도 | `barrier_free_map.html`, `app.js`, `registration.js`, `style.css` | 지도 페이지와 Leaflet 자산 경로. 로컬 `/vendor/leaflet` 경로를 Sites 정적 경로에 연결 |
| 운영 콘솔 | `control.html`, `control.js`, `control.css` | 운영 페이지와 `웹 지도 열기` 링크. 로컬 DB 경로 영역은 호스팅 환경에 맞춰 조정 |
| 공통 스타일과 API | `tokens.css`, `assets/`, `bfm-api.js` | 같은 출처의 `/api/*` JSON 응답 `{ data: ... }`, `/api/events`의 `data-changed`, GeoJSON 다운로드 경로 |
| 로컬 서버·DB | `server.js`, `data-bootstrap.js`, `electron-main.js` | Express API와 SQLite 스키마·쿼리를 호스팅 API와 D1로 교체. 변경 구독과 운영 페이지의 쓰기 권한을 그 환경에 맞게 연결 |

기존 Noto Sans KR 글꼴의 저작권 고지와 라이선스 전문은 [assets/fonts/OFL.txt](assets/fonts/OFL.txt)에 있습니다.
