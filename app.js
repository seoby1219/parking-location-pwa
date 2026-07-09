import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getFirestore, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const DEFAULT_CARS = {
  prius: { name: '우스', docId: 'us', defaultPhoto: './assets/prius.jpg' },
  morning: { name: '모닝', docId: 'morning', defaultPhoto: './assets/morning.png' }
};
const DEFAULT_MAP = './assets/parking-map.jpg';
const PARKING_ID = 'daeolgol';
const LS = {
  user: 'parkingUser',
  defaultUser: 'parkingDefaultUser',
  defaultCar: 'parkingDefaultCar',
  theme: 'parkingTheme',
  legacyCars: 'parkingCars',
  legacyPriusPhoto: 'parkingPriusPhoto',
  legacyMorningPhoto: 'parkingMorningPhoto',
  legacyMapImage: 'parkingMapImage',
  legacyPinSize: 'parkingPinSize'
};

let cars = {
  prius: { name: DEFAULT_CARS.prius.name, docId: DEFAULT_CARS.prius.docId, photo: DEFAULT_CARS.prius.defaultPhoto },
  morning: { name: DEFAULT_CARS.morning.name, docId: DEFAULT_CARS.morning.docId, photo: DEFAULT_CARS.morning.defaultPhoto }
};
let sharedSettings = { mapImage: DEFAULT_MAP, pinSize: 46 };
let db;
let selectedUser = localStorage.getItem(LS.defaultUser) || localStorage.getItem(LS.user) || '남편';
let selectedCar = localStorage.getItem(LS.defaultCar) || (selectedUser === '와이프' ? 'prius' : 'morning');
let carData = { prius: null, morning: null };
let draftPoint = null;
let firebaseReady = false;
let unsubscribe = [];
let sharedSettingsReady = false;

const $ = (id) => document.getElementById(id);
const els = {
  offlineBlock: $('offlineBlock'), retryBtn: $('retryBtn'), userBtn: $('userBtn'), refreshBtn: $('refreshBtn'),
  connectionText: $('connectionText'), mapWrap: $('mapWrap'), parkingMap: $('parkingMap'), savedPin: $('savedPin'), draftPin: $('draftPin'),
  timeText: $('timeText'), memoInput: $('memoInput'), saveBtn: $('saveBtn'), deleteBtn: $('deleteBtn'), toast: $('toast'), mapHint: $('mapHint'),
  settingsBtn: $('settingsBtn'), settingsSheet: $('settingsSheet'), closeSettingsBtn: $('closeSettingsBtn'),
  priusNameLabel: $('priusNameLabel'), morningNameLabel: $('morningNameLabel'), priusImg: $('priusImg'), morningImg: $('morningImg'),
  priusNameInput: $('priusNameInput'), morningNameInput: $('morningNameInput'), saveCarNamesBtn: $('saveCarNamesBtn'),
  priusPhotoInput: $('priusPhotoInput'), morningPhotoInput: $('morningPhotoInput'), mapImageInput: $('mapImageInput'),
  themeBtn: $('themeBtn'), pinSizeInput: $('pinSizeInput'), firebaseStatusText: $('firebaseStatusText'), resetSettingsBtn: $('resetSettingsBtn'),
  defaultUserSelect: $('defaultUserSelect'), defaultCarSelect: $('defaultCarSelect'), savePersonalSettingsBtn: $('savePersonalSettingsBtn'),
  tabPersonal: $('tabPersonal'), tabFamily: $('tabFamily'), personalPanel: $('personalPanel'), familyPanel: $('familyPanel'), mapLoader: $('mapLoader')
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function isOnlineReady() { return navigator.onLine && firebaseReady; }

function hasJongseong(text) {
  if (!text) return false;
  const ch = text.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return ((code - 0xac00) % 28) !== 0;
}
function subjectMarker(name) { return hasJongseong(name) ? '이' : '가'; }

function setOnlineUI() {
  const blocked = !isOnlineReady();
  els.offlineBlock.classList.toggle('hidden', !blocked);
  els.connectionText.textContent = blocked ? '온라인 공유 모드 준비 중' : '🟢 연결됨';
  els.saveBtn.disabled = blocked || !draftPoint;
  if (els.mapHint) els.mapHint.classList.toggle('ready', !!draftPoint && !blocked);
  els.deleteBtn.disabled = blocked;
  if (els.firebaseStatusText) {
    els.firebaseStatusText.textContent = blocked ? 'Firebase 연결 대기 중' : 'Firebase 연결 정상';
  }
}

function switchUser() {
  selectedUser = selectedUser === '남편' ? '와이프' : '남편';
  localStorage.setItem(LS.user, selectedUser);
  els.userBtn.textContent = selectedUser;
  if (els.defaultUserSelect) els.defaultUserSelect.value = selectedUser;
  renderCurrentCar();
  toast(`${selectedUser} 모드로 변경`);
}

function updateCarLabels() {
  els.priusNameLabel.textContent = cars.prius.name;
  els.morningNameLabel.textContent = cars.morning.name;
  els.priusNameInput.value = cars.prius.name;
  els.morningNameInput.value = cars.morning.name;
  els.priusImg.src = cars.prius.photo || DEFAULT_CARS.prius.defaultPhoto;
  els.morningImg.src = cars.morning.photo || DEFAULT_CARS.morning.defaultPhoto;
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
  const marker = subjectMarker(by);
  if (diffDays === 0) return { text: `🟢 오늘 ${hh}:${mm} · ${by}${marker} 저장`, fresh: true, empty: false };
  if (diffDays === 1) return { text: `🔴 어제 ${hh}:${mm} · ${by}${marker} 저장`, fresh: false, empty: false };
  return { text: `🔴 ${diffDays}일 전 ${hh}:${mm} · ${by}${marker} 저장`, fresh: false, empty: false };
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
    await setDoc(doc(db, 'parking', PARKING_ID, 'cars', cars[selectedCar].docId), {
      carKey: selectedCar,
      carDocId: cars[selectedCar].docId,
      carName: cars[selectedCar].name,
      parkingLotId: PARKING_ID,
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
    await deleteDoc(doc(db, 'parking', PARKING_ID, 'cars', cars[selectedCar].docId));
    toast('위치를 삭제했습니다.');
  } catch (err) {
    console.error(err);
    toast('삭제 실패: Firestore 설정을 확인하세요.');
  }
}

function openSettings() { els.settingsSheet.classList.remove('hidden'); syncSettingsInputs(); }
function closeSettings() { els.settingsSheet.classList.add('hidden'); }
function switchSettingsTab(tab) {
  const isPersonal = tab === 'personal';
  els.tabPersonal.classList.toggle('active', isPersonal);
  els.tabFamily.classList.toggle('active', !isPersonal);
  els.personalPanel.classList.toggle('hidden', !isPersonal);
  els.familyPanel.classList.toggle('hidden', isPersonal);
}

function syncSettingsInputs() {
  els.priusNameInput.value = cars.prius.name;
  els.morningNameInput.value = cars.morning.name;
  els.pinSizeInput.value = sharedSettings.pinSize || 46;
  els.defaultUserSelect.value = localStorage.getItem(LS.defaultUser) || selectedUser;
  els.defaultCarSelect.value = localStorage.getItem(LS.defaultCar) || selectedCar;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compressImageFile(file, maxWidth, maxHeight, quality = 0.82) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

async function updateSharedSettings(patch, message) {
  if (!isOnlineReady()) { toast('Firebase 연결 후 변경할 수 있습니다.'); return; }
  try {
    await setDoc(doc(db, 'parking', PARKING_ID, 'settings', 'shared'), {
      ...patch,
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast(message);
  } catch (err) {
    console.error(err);
    toast('설정 저장 실패: 이미지가 너무 크면 더 작은 사진으로 시도하세요.');
  }
}

async function saveCarNames() {
  const priusName = els.priusNameInput.value.trim() || DEFAULT_CARS.prius.name;
  const morningName = els.morningNameInput.value.trim() || DEFAULT_CARS.morning.name;
  await updateSharedSettings({ carNames: { prius: priusName, morning: morningName } }, '차량 이름을 가족 설정에 저장했습니다.');
}

async function handleImageSetting(input, type) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    let dataUrl;
    if (type === 'map') {
      dataUrl = await compressImageFile(file, 1600, 1000, 0.84);
      await updateSharedSettings({ mapImage: dataUrl }, '지도를 가족 설정에 저장했습니다.');
    } else {
      dataUrl = await compressImageFile(file, 700, 420, 0.86);
      const patch = type === 'prius' ? { carPhotos: { prius: dataUrl, morning: cars.morning.photo } } : { carPhotos: { prius: cars.prius.photo, morning: dataUrl } };
      await updateSharedSettings(patch, `${type === 'prius' ? cars.prius.name : cars.morning.name} 사진을 가족 설정에 저장했습니다.`);
    }
  } catch (err) {
    console.error(err);
    toast('이미지 처리 실패: 다른 사진으로 시도하세요.');
  } finally { input.value = ''; }
}

function applyLocalSettings() {
  const theme = localStorage.getItem(LS.theme) || 'light';
  document.body.classList.toggle('dark', theme === 'dark');
}

function applySharedSettings(data = {}) {
  const names = data.carNames || {};
  const photos = data.carPhotos || {};
  cars.prius.name = names.prius || DEFAULT_CARS.prius.name;
  cars.morning.name = names.morning || DEFAULT_CARS.morning.name;
  cars.prius.photo = photos.prius || DEFAULT_CARS.prius.defaultPhoto;
  cars.morning.photo = photos.morning || DEFAULT_CARS.morning.defaultPhoto;
  sharedSettings.mapImage = data.mapImage || DEFAULT_MAP;
  sharedSettings.pinSize = Number(data.pinSize || 46);
  updateCarLabels();
  setMapImage(sharedSettings.mapImage);
  document.documentElement.style.setProperty('--pin-size', `${sharedSettings.pinSize}px`);
  if (els.pinSizeInput) els.pinSizeInput.value = sharedSettings.pinSize;
  renderCurrentCar();
}

function setMapImage(src) {
  els.mapWrap.classList.add('map-loading');
  if (els.mapLoader) els.mapLoader.classList.remove('hidden');
  els.parkingMap.classList.remove('loaded');
  if (els.parkingMap.src === src || els.parkingMap.getAttribute('src') === src) {
    if (els.parkingMap.complete && els.parkingMap.naturalWidth > 0) finishMapLoad();
    return;
  }
  els.parkingMap.src = src;
}
function finishMapLoad() {
  els.mapWrap.classList.remove('map-loading');
  if (els.mapLoader) els.mapLoader.classList.add('hidden');
  els.parkingMap.classList.add('loaded');
}

function savePersonalSettings() {
  const defaultUser = els.defaultUserSelect.value;
  const defaultCar = els.defaultCarSelect.value;
  localStorage.setItem(LS.defaultUser, defaultUser);
  localStorage.setItem(LS.defaultCar, defaultCar);
  selectedUser = defaultUser;
  selectedCar = defaultCar;
  localStorage.setItem(LS.user, selectedUser);
  els.userBtn.textContent = selectedUser;
  selectCar(selectedCar);
  toast('내 설정을 저장했습니다.');
}

function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem(LS.theme, next);
  applyLocalSettings();
}

function resetSettings() {
  if (!confirm('내 설정을 초기화할까요? 가족 공용 설정은 삭제하지 않습니다.')) return;
  [LS.defaultUser, LS.defaultCar, LS.theme, LS.user].forEach(k => localStorage.removeItem(k));
  selectedUser = '남편';
  selectedCar = 'morning';
  els.userBtn.textContent = selectedUser;
  applyLocalSettings();
  selectCar(selectedCar);
  syncSettingsInputs();
  toast('내 설정을 초기화했습니다.');
}

function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    firebaseReady = true;

    unsubscribe.push(onSnapshot(doc(db, 'parking', PARKING_ID, 'settings', 'shared'), snap => {
      sharedSettingsReady = true;
      applySharedSettings(snap.exists() ? snap.data() : {});
      setOnlineUI();
    }, err => {
      console.error(err);
      sharedSettingsReady = false;
      setOnlineUI();
    }));

    ['prius', 'morning'].forEach(carKey => {
      unsubscribe.push(onSnapshot(doc(db, 'parking', PARKING_ID, 'cars', DEFAULT_CARS[carKey].docId), snap => {
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

// 초기 이벤트 연결
els.userBtn.textContent = selectedUser;
els.userBtn.addEventListener('click', switchUser);
els.retryBtn.addEventListener('click', () => location.reload());
els.refreshBtn.addEventListener('click', () => location.reload());
els.mapWrap.addEventListener('click', mapClick);
els.parkingMap.addEventListener('load', finishMapLoad);
els.parkingMap.addEventListener('error', () => {
  if (els.mapLoader) els.mapLoader.textContent = '지도를 다시 불러와 주세요.';
});
els.saveBtn.addEventListener('click', saveLocation);
els.deleteBtn.addEventListener('click', deleteLocation);
document.querySelectorAll('.car-card').forEach(btn => btn.addEventListener('click', () => selectCar(btn.dataset.car)));
window.addEventListener('online', setOnlineUI);
window.addEventListener('offline', setOnlineUI);
els.settingsBtn.addEventListener('click', openSettings);
els.closeSettingsBtn.addEventListener('click', closeSettings);
els.settingsSheet.addEventListener('click', (e) => { if (e.target === els.settingsSheet) closeSettings(); });
els.tabPersonal.addEventListener('click', () => switchSettingsTab('personal'));
els.tabFamily.addEventListener('click', () => switchSettingsTab('family'));
els.savePersonalSettingsBtn.addEventListener('click', savePersonalSettings);
els.saveCarNamesBtn.addEventListener('click', saveCarNames);
els.priusPhotoInput.addEventListener('change', () => handleImageSetting(els.priusPhotoInput, 'prius'));
els.morningPhotoInput.addEventListener('change', () => handleImageSetting(els.morningPhotoInput, 'morning'));
els.mapImageInput.addEventListener('change', () => handleImageSetting(els.mapImageInput, 'map'));
els.themeBtn.addEventListener('click', toggleTheme);
els.pinSizeInput.addEventListener('input', () => {
  const size = Number(els.pinSizeInput.value);
  document.documentElement.style.setProperty('--pin-size', `${size}px`);
});
els.pinSizeInput.addEventListener('change', () => {
  updateSharedSettings({ pinSize: Number(els.pinSizeInput.value) }, '핀 크기를 가족 설정에 저장했습니다.');
});
els.resetSettingsBtn.addEventListener('click', resetSettings);

applyLocalSettings();
updateCarLabels();
setMapImage(DEFAULT_MAP);
selectCar(selectedCar);
setOnlineUI();
initFirebase();
