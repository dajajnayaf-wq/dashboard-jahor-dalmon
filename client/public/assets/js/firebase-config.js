// إعدادات Firebase — مشروع kuwait-jaho (موحّد للموقع ولوحة التحكم)
const firebaseConfig = {
  apiKey: "AIzaSyDk7k4dUnZkeHZXgSQ6jTM8Ij--9FEL1EE",
  authDomain: "kuwait-jaho.firebaseapp.com",
  databaseURL: "https://kuwait-jaho-default-rtdb.firebaseio.com/",
  projectId: "kuwait-jaho",
  storageBucket: "kuwait-jaho.firebasestorage.app",
  messagingSenderId: "551882030134",
  appId: "1:551882030134:web:8afd5b68edefb5a258ac97",
  measurementId: "G-WXB5DKGCS3"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const rtd = firebase.database();
window.db = db;
window.rtd = rtd;
