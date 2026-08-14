const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 정적 파일 서빙 (프론트엔드 웹사이트)
app.use(express.static(path.join(__dirname)));

// 루트 엔드포인트 접속 시 명시적으로 메인 HTML 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'barrier_free_map_prototype_v5.html'));
});

// SQLite 데이터베이스 연결 및 초기화
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('SQLite 데이터베이스 연결 오류:', err.message);
    } else {
        console.log('✅ SQLite 데이터베이스 연결 성공');
        
        // 초기 스키마 쿼리 실행
        db.serialize(() => {
            // nodes (마커 정보) 테이블 생성
            db.run(`
                CREATE TABLE IF NOT EXISTS nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    color TEXT,
                    attributes TEXT,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL
                )
            `);
            
            // polygons (구역 정보) 테이블 생성
            db.run(`
                CREATE TABLE IF NOT EXISTS polygons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    paths TEXT NOT NULL
                )
            `);
            console.log('✅ 데이터베이스 스키마 초기화 완료');
        });
    }
});

// API 엔드포인트: 노드 데이터 조회 (GET /api/nodes)
app.get('/api/nodes', (req, res) => {
    db.all("SELECT * FROM nodes", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // attributes 필드를 다시 JSON 객체로 파싱하여 반환
        const nodes = rows.map(row => ({
            ...row,
            attributes: row.attributes ? JSON.parse(row.attributes) : {}
        }));
        res.json({ data: nodes });
    });
});

// API 엔드포인트: 새로운 노드 생성 (POST /api/nodes)
app.post('/api/nodes', (req, res) => {
    const { name, category, color, attributes, lat, lng } = req.body;
    
    if (!name || !category || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: '필수 데이터가 누락되었습니다.' });
    }
    
    const attrsStr = attributes ? JSON.stringify(attributes) : '{}';
    
    const sql = `INSERT INTO nodes (name, category, color, attributes, lat, lng) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [name, category, color, attrsStr, lat, lng];
    
    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({
            message: '노드가 성공적으로 생성되었습니다.',
            data: {
                id: this.lastID,
                name, category, color, attributes, lat, lng
            }
        });
    });
});

// 서버 실행
app.listen(PORT, () => {
    console.log(`🚀 배리어 프리 맵 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
