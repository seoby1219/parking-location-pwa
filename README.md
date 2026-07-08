# 우리집 주차위치 PWA V4.4

## 반영 내용
- Firebase Firestore 실시간 연결
- 저장 경로: `parking/daeolgol/cars/us`, `parking/daeolgol/cars/morning`
- 지도 터치 위치 저장
- 우스/모닝 차량별 독립 저장
- 남편/와이프 저장자 전환
- 오늘/어제/N일 전 시간 표시
- 온라인 연결 상태에서만 저장 및 확인 가능

## GitHub Pages 업로드
저장소 루트에 모든 파일과 폴더를 업로드하세요.

필수 구조:
```
index.html
styles.css
app.js
firebase-config.js
manifest.webmanifest
service-worker.js
assets/
  parking-map.png
  prius.svg
  morning.svg
```

## 테스트 방법
1. GitHub Pages 주소 접속
2. 우스 선택
3. 지도 위 위치 터치
4. 현재 위치 저장 클릭
5. Firebase Firestore에서 `parking > daeolgol > cars > us` 문서 생성 확인
6. 다른 기기에서 같은 주소 접속 후 위치가 표시되는지 확인
