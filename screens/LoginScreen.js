import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { useEffect, useState } from "react";
import { Card, CheckBox } from "react-native-elements";
import { FIREBASE_APP, FIREBASE_AUTH } from "../firebaseConfig";
import {
  signInWithEmailAndPassword,
  getAuth,
  browserLocalPersistence,
  setPersistence
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import { useDispatch } from "react-redux";
import { setQuizzes } from "../Progress/CourseSlice";
import * as SecureStore from "expo-secure-store";
import { FIRESTORE_DB } from "../firebaseConfig";

const auth = FIREBASE_AUTH;

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);

  const dispatch = useDispatch();

  useEffect(() => {
    SecureStore.getItemAsync("userinfo").then((userdata) => {
      const userInfo = JSON.parse(userdata);
      if (userInfo) {
        setEmail(userInfo.email);
        setPassword(userInfo.password);
        setRemember(true);
      }
    });
  }, []);

  const Login = async () => {
    console.log("Email: ", email);
    console.log("Password: ", password);
    console.log("remember: ", remember);

    if (remember) {
      try {
        await SecureStore.setItemAsync(
          "userinfo",
          JSON.stringify({
            email,
            password,
          })
        );
        console.log("User info saved.");
      } catch (error) {
        console.log("Could not save user info", error);
      }
    } else {
      try {
        await SecureStore.deleteItemAsync("userinfo");
        console.log("User info deleted.");
      } catch (error) {
        console.log("Could not delete user info", error);
      }
    }

    setLoading(true);
    try {
      const response = await signInWithEmailAndPassword(auth, email, password);
      console.log(response);
      const db = FIRESTORE_DB;
      const userRef = doc(db, "users", response.user.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();
      const quizzesData = userData.quizzes || [];
      console.log("quizzes data fetched from firestore:", quizzesData);
      dispatch(setQuizzes(quizzesData));
      console.log("quizzes data dispatched to redux state.");
      navigation.navigate("Main");
    } catch (error) {
      console.error(error);
      alert("Login failed " + error.message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <View style={styles.mainContainer}>
      <KeyboardAvoidingView behavior="padding">
        <Card containerStyle={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            autoCapitalize="none"
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            autoCapitalize="none"
            onChangeText={setPassword}
            secureTextEntry={true}
          />
          {loading ? (
            <ActivityIndicator size="large" color="steelblue" />
          ) : (
            <>
              <CheckBox
                title="Remember Me"
                center
                checked={remember}
                onPress={() => setRemember(!remember)}
                containerStyle={styles.formCheckbox}
              />
              <Button title="Login" onPress={Login} />
            </>
          )}
          <View style={styles.btn}></View>
        </Card>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: "black",
  },
  card: {
    backgroundColor: "silver",
    alignContent: "center",
    margin: 23,
    top: 222,
    borderRadius: 33,
  },
  title: {
    color: "white",
    fontSize: 22,
    marginBottom: 12,
    textAlign: "center",
    shadowColor: "black",
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 5,
  },
  input: {
    backgroundColor: "gainsboro",
    fontSize: 18,
    padding: 22,
    margin: 5,
    borderRadius: 222,
    shadowColor: "steelblue",
    shadowOffset: { width: 1, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 33,
    elevation: 5,
  },
  btn: {
    padding: 22,
  },
});

export default LoginScreen;
