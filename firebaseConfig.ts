// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDL0LY3rxOqnIhxWdAOfjpE2v6gFbmBeB8",
  authDomain: "shakespearenativeapp.firebaseapp.com",
  projectId: "shakespearenativeapp",
  storageBucket: "shakespearenativeapp.appspot.com",
  messagingSenderId: "415561942799",
  appId: "1:415561942799:web:5b3c364e8582879206e07a",
  measurementId: "G-2RMM083CBE"
};

// Initialize Firebase
export const FIREBASE_APP = initializeApp(firebaseConfig);
export const FIREBASE_AUTH = getAuth(FIREBASE_APP)
export const FIRESTORE_DB = getFirestore(FIREBASE_APP)
