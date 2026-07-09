import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getFirestore, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const DEFAULT_CARS = {
  prius: { name: '우스', docId: 'us' },
  morning: { name: '모닝', docId: 'morning' }
};
let cars = loadCars();
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
  connectionText: $('connectionText'), mapWrap: $('mapWrap'), parkingMap: $('parkingMap'), savedPin: $('savedPin'), draftPin: $('draftPin'),
  timeText: $('timeText'), memoInput: $('memoInput'), saveBtn: $('saveBtn'), deleteBtn: $('deleteBtn'), toast: $('toast'), mapHint: $('mapHint'),
  settingsBtn: $('settingsBtn'), settingsSheet: $('settingsSheet'), closeSettingsBtn: $('closeSettingsBtn'),
  priusNameLabel: $('priusNameLabel'), morningNameLabel: $('morningNameLabel'), priusImg: $('priusImg'), morningImg: $('morningImg'),
  priusNameInput: $('priusNameInput'), morningNameInput: $('morningNameInput'), saveCarNamesBtn: $('saveCarNamesBtn'),
  priusPhotoInput: $('priusPhotoInput'), morningPhotoInput: $('morningPhotoInput'), mapImageInput: $('mapImageInput'),
  themeBtn: $('themeBtn'), pinSizeInput: $('pinSizeInput'), firebaseStatusText: $('firebaseStatusText'), resetSettingsBtn: $('resetSettingsBtn')
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function loadCars() {
  try { return { ...DEFAULT_CARS, ...(JSON.parse(localStorage.getItem('parkingCars') || '{}')) }; }
  catch { return { ...DEFAULT_CARS }; }
}
function saveCars() { localStorage.setItem('parkingCars', JSON.stringify(cars)); }
function isOnlineReady() { return navigator.onLine && firebaseReady; }

function setOnlineUI() {
  const blocked = !isOnlineReady();
  els.offlineBlock.classList.toggle('hidden', !blocked);
  els.connectionText.textContent = blocked ? '온라인 공유 모드 준비 중' : '🟢 연결됨';
  els.saveBtn.disabled = blocked || !draftPoint;
  if (els.mapHint) els.mapHint.classList.toggle('ready', !!draftPoint && !blocked);
  els.deleteBtn.disabled = blocked;
  els.firebaseStatusText.textContent = blocked ? 'Firebase 연결 대기 중' : 'Firebase 연결 정상';
}

function switchUser() {
  selectedUser = selectedUser === '남편' ? '와이프' : '남편';
  localStorage.setItem('parkingUser', selectedUser);
  els.userBtn.textContent = selectedUser;
  toast(`${selectedUser} 모드로 변경`);
}

function updateCarLabels() {
  els.priusNameLabel.textContent = cars.prius.name;
  els.morningNameLabel.textContent = cars.morning.name;
  els.priusNameInput.value = cars.prius.name;
  els.morningNameInput.value = cars.morning.name;
}

function selectCar(carKey) {
  selectedCar = carKey;
  draftPoint = null;
  document.querySelectorAll('.car-card').forEach(btn => btn.classList.toggle('active', btn.dataset.car === carKey));
  els.draftPin.classList.add('hidden');
  if (els.mapHint) els.mapHint.textContent = '지도를 터치해서 주차 위치를 선택하세요.';
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

function formatParkingTime(value, savedBy = '-') {
  if (!value) return { text: '저장된 위치가 없습니다.', fresh: false, empty: true };
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return { text: '저장된 위치가 있습니다.', fresh: false, empty: false };
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((startToday - startTarget) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const by = savedBy && savedBy !== '-' ? savedBy : '저장자';
  if (diffDays === 0) return { text: `🟢 오늘 ${hh}:${mm} · ${by}가 저장`, fresh: true, empty: false };
  if (diffDays === 1) return { text: `🔴 어제 ${hh}:${mm} · ${by}가 저장`, fresh: false, empty: false };
  return { text: `🔴 ${diffDays}일 전 ${hh}:${mm} · ${by}가 저장`, fresh: false, empty: false };
}

function renderCurrentCar() {
  const data = carData[selectedCar];
  if (!data) {
    els.timeText.textContent = '저장된 위치가 없습니다.';
    els.timeText.classList.remove('today', 'old');
    els.timeText.classList.add('empty');
    els.memoInput.value = '';
    placePin(els.savedPin, null);
    setOnlineUI();
    return;
  }
  const formatted = formatParkingTime(data.updatedAt || data.savedAt, data.savedBy);
  els.timeText.textContent = formatted.text;
  els.timeText.classList.remove('today', 'old', 'empty');
  els.timeText.classList.add(formatted.empty ? 'empty' : (formatted.fresh ? 'today' : 'old'));
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
  if (els.mapHint) els.mapHint.textContent = '선택한 위치가 맞으면 아래 저장 버튼을 누르세요.';
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
    toast(`${cars[selectedCar].name} 위치를 저장했습니다.`);
    if (els.mapHint) els.mapHint.textContent = '지도를 터치해서 주차 위치를 선택하세요.';
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

function openSettings() { els.settingsSheet.classList.remove('hidden'); }
function closeSettings() { els.settingsSheet.classList.add('hidden'); }

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageSetting(input, storageKey, imgEl, message) {
  const file = input.files && input.files[0];
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  localStorage.setItem(storageKey, dataUrl);
  imgEl.src = dataUrl;
  toast(message);
  input.value = '';
}

function applyStoredSettings() {
  updateCarLabels();
  const priusPhoto = localStorage.getItem('parkingPriusPhoto');
  const morningPhoto = localStorage.getItem('parkingMorningPhoto');
  const mapImage = localStorage.getItem('parkingMapImage');
  const theme = localStorage.getItem('parkingTheme') || 'light';
  const pinSize = localStorage.getItem('parkingPinSize') || '46';
  if (priusPhoto) els.priusImg.src = priusPhoto;
  if (morningPhoto) els.morningImg.src = morningPhoto;
  if (mapImage) els.parkingMap.src = mapImage;
  document.body.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.setProperty('--pin-size', `${pinSize}px`);
  els.pinSizeInput.value = pinSize;
}

function saveCarNames() {
  cars.prius.name = els.priusNameInput.value.trim() || DEFAULT_CARS.prius.name;
  cars.morning.name = els.morningNameInput.value.trim() || DEFAULT_CARS.morning.name;
  saveCars();
  updateCarLabels();
  renderCurrentCar();
  toast('차량 이름을 저장했습니다.');
}

function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('parkingTheme', next);
  applyStoredSettings();
}

function resetSettings() {
  if (!confirm('차량 이름, 사진, 지도, 테마 설정을 초기화할까요?')) return;
  ['parkingCars','parkingPriusPhoto','parkingMorningPhoto','parkingMapImage','parkingTheme','parkingPinSize'].forEach(k => localStorage.removeItem(k));
  cars = loadCars();
  els.priusImg.src = './assets/prius.jpg';
  els.morningImg.src = './assets/morning.png';
  els.parkingMap.src = './assets/parking-map.jpg';
  applyStoredSettings();
  renderCurrentCar();
  toast('설정을 초기화했습니다.');
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
document.querySelectorAll('.car-card').forEach(btn => btn.addEventListener('click', () => selectCar(btn.dataset.car)));
window.addEventListener('online', setOnlineUI);
window.addEventListener('offline', setOnlineUI);
els.settingsBtn.addEventListener('click', openSettings);
els.closeSettingsBtn.addEventListener('click', closeSettings);
els.settingsSheet.addEventListener('click', (e) => { if (e.target === els.settingsSheet) closeSettings(); });
els.saveCarNamesBtn.addEventListener('click', saveCarNames);
els.priusPhotoInput.addEventListener('change', () => handleImageSetting(els.priusPhotoInput, 'parkingPriusPhoto', els.priusImg, '우스 사진을 변경했습니다.'));
els.morningPhotoInput.addEventListener('change', () => handleImageSetting(els.morningPhotoInput, 'parkingMorningPhoto', els.morningImg, '모닝 사진을 변경했습니다.'));
els.mapImageInput.addEventListener('change', () => handleImageSetting(els.mapImageInput, 'parkingMapImage', els.parkingMap, '지도를 변경했습니다.'));
els.themeBtn.addEventListener('click', toggleTheme);
els.pinSizeInput.addEventListener('input', () => {
  const size = els.pinSizeInput.value;
  localStorage.setItem('parkingPinSize', size);
  document.documentElement.style.setProperty('--pin-size', `${size}px`);
});
els.resetSettingsBtn.addEventListener('click', resetSettings);

applyStoredSettings();
renderCurrentCar();
setOnlineUI();
initFirebase();
