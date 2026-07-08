Parking Location PWA V4.1
- 우스/모닝 차량 이름 아래 설명 문구 제거
- V4 디자인 베이스 유지

우리집 주차위치 PWA V4

구성
- 지도 1개 전용: assets/parking-map.png
- 차량 2대: 우스, 모닝
- Firebase Firestore 온라인 공유 전용
- 오프라인/로컬 저장 기능 없음

중요
1. Firebase 콘솔에서 Firestore Database를 먼저 생성해야 저장/확인이 됩니다.
2. Firestore 규칙은 테스트 단계에서 아래처럼 설정하면 바로 확인 가능합니다.

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /parking_locations/{carId} {
      allow read, write: if true;
    }
  }
}

테스트 후에는 보안 규칙을 로그인 기반으로 바꾸는 것을 권장합니다.


V4.2 변경사항
- Firestore 저장 경로: parking / daeolgol / cars / us, morning
- 지도 1개(대올골) 집중 구조 유지
- 우스/모닝 이름 아래 설명 제거 유지
