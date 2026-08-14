const puppeteer = require('puppeteer');

(async () => {
    console.log('🚀 브라우저 테스트 시작');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox']
        });
    } catch(err) {
        console.error('브라우저 실행 실패 (Puppeteer Chrome 바이너리 누락 가능성):', err.message);
        process.exit(1);
    }
    
    const page = await browser.newPage();
    
    // 브라우저 내부 콘솔 로그 캡처
    page.on('console', msg => console.log('💻 브라우저 콘솔:', msg.text()));
    
    try {
        console.log('🔗 http://localhost:3000 접속 중...');
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
        
        console.log('🗺️ 지도 컨테이너 로드 대기 중...');
        await page.waitForSelector('#map', { timeout: 10000 });
        
        // Naver Map requires tiles to be fully loaded and events attached
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('🖱️ 지도 위 임의의 위치 클릭 (장소 등록 모달 열기)...');
        // Click near the center of the map. Sometimes the center is covered by a marker or control, so offset it.
        const mapElement = await page.$('#map');
        const box = await mapElement.boundingBox();
        await page.mouse.click(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50);
        
        console.log('⏳ 모달 오버레이 대기 중...');
        // Wait longer for the animation or overlay
        await page.waitForSelector('#modal-overlay.active', { timeout: 10000 });
        
        console.log('✍️ 노드 이름 입력 중...');
        await page.type('#node-name', '테스트 자동 생성 마커');
        
        console.log('💾 저장 버튼 클릭...');
        await page.click('#btn-modal-save');
        
        console.log('⏳ 목록에 새 항목이 추가되는지 대기 중...');
        await new Promise(r => setTimeout(r, 2000));
        
        // 목록 탭 클릭
        await page.evaluate(() => {
            const tabs = document.querySelectorAll('.tab');
            tabs.forEach(t => {
                if(t.getAttribute('data-tab') === 'tab-list') t.click();
            });
        });
        
        await new Promise(r => setTimeout(r, 500));
        
        const listItemsCount = await page.$$eval('.coord-item', items => items.length);
        
        if (listItemsCount > 0) {
            console.log(`✅ 테스트 성공: 목록에 ${listItemsCount}개의 장소가 정상적으로 렌더링되었습니다.`);
            
            const hasTestNode = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.coord-item'));
                return items.some(item => item.innerText.includes('테스트 자동 생성 마커'));
            });
            
            if (hasTestNode) {
                console.log('✅ 테스트 성공: DB에 마커 데이터가 올바르게 전송되고 저장되었습니다.');
            } else {
                console.log('❌ 테스트 실패: 렌더링은 되었으나 입력한 이름의 마커를 찾을 수 없습니다.');
            }
        } else {
            console.log('❌ 테스트 실패: 목록 탭에 렌더링된 장소가 없습니다.');
        }
        
    } catch (err) {
        console.error('❌ 테스트 중 에러 발생:', err);
    } finally {
        if(browser) await browser.close();
        console.log('🏁 브라우저 테스트 종료');
    }
})();
