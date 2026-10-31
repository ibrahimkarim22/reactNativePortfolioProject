import { onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromServer, onSnapshot, runTransaction } from "firebase/firestore";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { createFirestoreCourseProgressTransport } from "./firestoreCourseProgress";
import { createCourseProgressSession } from "./courseProgressSession";

// The normal app uses the existing account/profile. No quiz text or second
// progress database is involved; Redux receives a view of confirmed progress.
export const normalCourseProgress = createCourseProgressSession({
  getUid: () => FIREBASE_AUTH.currentUser?.uid || null,
  subscribeAuth: notify => onAuthStateChanged(FIREBASE_AUTH, user => notify(user?.uid || null)),
  transport: createFirestoreCourseProgressTransport({
    db: FIRESTORE_DB, doc, onSnapshot, runTransaction, getDocFromServer,
  }),
});
