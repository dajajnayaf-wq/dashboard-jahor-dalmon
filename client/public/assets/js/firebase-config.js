// إعدادات Firebase — مشروع kuwait-b7d4b (موحّد للموقع ولوحة التحكم)
const firebaseConfig = {
  apiKey: "AIzaSyAfWfzLyUlsq3NFsU2JK-qcIZkXgN023U0",
  authDomain: "kuwait-b7d4b.firebaseapp.com",
  databaseURL: "https://kuwait-b7d4b-default-rtdb.firebaseio.com",
  projectId: "kuwait-b7d4b",
  storageBucket: "kuwait-b7d4b.firebasestorage.app",
  messagingSenderId: "686238776602",
  appId: "1:686238776602:web:dfb65a9525b3b86cd740a3"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const rtd = firebase.database();
window.db = db;
window.rtd = rtd;
