import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getFirestore, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const cars = {
  prius: { name: '우스', docId: 'us' },
  morning: { name: '모닝', docId: 'morning' }
};

let db;
let selectedCar = 'prius';
let selectedUser = localStorage.getItem('parkingUser') || '남편';
let carData = { prius: null, morning: null };
let draftPoint = null;
let firebaseReady = false;
let unsubscribe = [];

const $ = (id) => document.getElementById(id);
const els = {
  offlineBlock: $('offlineBlock'), retryBtn: $('retryBtn'), userBtn: $('userBtn'), refreshBtn: $('refreshBtn'),
  connectionText: $('connectionText'), mapWrap: $('mapWrap'), savedPin: $('savedPin'), draftPin: $('draftPin'),
  timeText: $('timeText'), savedByText: $('savedByText'), carNameText: $('carNameText'), memoInput: $('memoInput'),
  saveBtn: $('saveBtn'), deleteBtn: $('deleteBtn'), gpsBtn: $('gpsBtn'), toast: $('toast')
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function isOnlineReady() { return navigator.onLine && firebaseReady; }

function setOnlineUI() {
  const blocked = !isOnlineReady();
  els.offlineBlock.classList.toggle('hidden', !blocked);
  els.connectionText.textContent = blocked ? '온라인 공유 모드 준비 중' : '온라인 공유 연결됨';
  els.saveBtn.disabled = blocked || !draftPoint;
  els.deleteBtn.disabled = blocked;
}

function switchUser() {
  selectedUser = selectedUser === '남편' ? '와이프' : '남편';
  localStorage.setItem('parkingUser', selectedUser);
  els.userBtn.textContent = selectedUser;
  toast(`${selectedUser} 모드로 변경`);
}

function selectCar(carKey) {
  selectedCar = carKey;
  draftPoint = null;
  document.querySelectorAll('.car-card').forEach(btn => btn.classList.toggle('active', btn.dataset.car === carKey));
  els.carNameText.textContent = cars[carKey].name;
  els.draftPin.classList.add('hidden');
  renderCurrentCar();
}

function placePin(pinEl, point) {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    pinEl.classList.add('hidden');
    return;
  }
  pinEl.style.left = `${point.x}%`;
  pinEl.style.top = `${point.y}%`;
  pinEl.classList.remove('hidden');
}

function formatParkingTime(value) {
  if (!value) return '저장된 위치가 없습니다.';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '저장된 위치가 있습니다.';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((startToday - startTarget) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (diffDays === 0) return `오늘 ${hh}:${mm}에 주차된 위치입니다.`;
  if (diffDays === 1) return `어제 ${hh}:${mm}에 주차된 위치입니다.`;
  return `${diffDays}일 전 ${hh}:${mm}에 주차된 위치입니다.`;
}

function renderCurrentCar() {
  const data = carData[selectedCar];
  els.carNameText.textContent = cars[selectedCar].name;
  if (!data) {
    els.timeText.textContent = '저장된 위치가 없습니다.';
    els.savedByText.textContent = '-';
    els.memoInput.value = '';
    placePin(els.savedPin, null);
    setOnlineUI();
    return;
  }
  els.timeText.textContent = formatParkingTime(data.updatedAt || data.savedAt);
  els.savedByText.textContent = data.savedBy || '-';
  els.memoInput.value = data.memo || '';
  placePin(els.savedPin, data);
  setOnlineUI();
}

function mapClick(e) {
  if (!isOnlineReady()) { setOnlineUI(); return; }
  const rect = els.mapWrap.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  draftPoint = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  placePin(els.draftPin, draftPoint);
  els.saveBtn.disabled = false;
}

async function saveLocation() {
  if (!isOnlineReady() || !draftPoint) return;
  els.saveBtn.disabled = true;
  try {
    await setDoc(doc(db, 'parking', 'daeolgol', 'cars', cars[selectedCar].docId), {
      carKey: selectedCar,
      carDocId: cars[selectedCar].docId,
      carName: cars[selectedCar].name,
      parkingLotId: 'daeolgol',
      x: Number(draftPoint.x.toFixed(4)),
      y: Number(draftPoint.y.toFixed(4)),
      memo: els.memoInput.value.trim(),
      savedBy: selectedUser,
      updatedAt: serverTimestamp()
    }, { merge: true });
    draftPoint = null;
    els.draftPin.classList.add('hidden');
    toast('주차 위치를 저장했습니다.');
  } catch (err) {
    console.error(err);
    toast('저장 실패: Firestore 설정을 확인하세요.');
  } finally { setOnlineUI(); }
}

async function deleteLocation() {
  if (!isOnlineReady()) return;
  if (!confirm(`${cars[selectedCar].name} 위치를 삭제할까요?`)) return;
  try {
    await deleteDoc(doc(db, 'parking', 'daeolgol', 'cars', cars[selectedCar].docId));
    toast('위치를 삭제했습니다.');
  } catch (err) {
    console.error(err);
    toast('삭제 실패: Firestore 설정을 확인하세요.');
  }
}

function showGps() {
  if (!navigator.geolocation) { toast('현재 위치 기능을 사용할 수 없습니다.'); return; }
  navigator.geolocation.getCurrentPosition(
    () => toast('현재 위치 확인됨. 지도 위 직접 위치와 비교하세요.'),
    () => toast('현재 위치 권한이 필요합니다.'),
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    firebaseReady = true;
    ['prius', 'morning'].forEach(carKey => {
      unsubscribe.push(onSnapshot(doc(db, 'parking', 'daeolgol', 'cars', cars[carKey].docId), snap => {
        carData[carKey] = snap.exists() ? snap.data() : null;
        if (selectedCar === carKey) renderCurrentCar();
      }, err => {
        console.error(err);
        firebaseReady = false;
        setOnlineUI();
        els.connectionText.textContent = 'Firestore 연결 실패';
      }));
    });
    setOnlineUI();
  } catch (err) {
    console.error(err);
    firebaseReady = false;
    setOnlineUI();
  }
}

els.userBtn.textContent = selectedUser;
els.userBtn.addEventListener('click', switchUser);
els.retryBtn.addEventListener('click', () => location.reload());
els.refreshBtn.addEventListener('click', () => location.reload());
els.mapWrap.addEventListener('click', mapClick);
els.saveBtn.addEventListener('click', saveLocation);
els.deleteBtn.addEventListener('click', deleteLocation);
els.gpsBtn.addEventListener('click', showGps);
document.querySelectorAll('.car-card').forEach(btn => btn.addEventListener('click', () => selectCar(btn.dataset.car)));
window.addEventListener('online', setOnlineUI);
window.addEventListener('offline', setOnlineUI);

renderCurrentCar();
setOnlineUI();
initFirebase();
