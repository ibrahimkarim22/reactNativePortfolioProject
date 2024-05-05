import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Card } from "react-native-elements";
import { useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { getFirestore, collection, doc, setDoc } from "firebase/firestore";

const SignUpScreen = () => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const auth = FIREBASE_AUTH;

  const SignUp = async () => {
    setLoading(true);
    try {
      const response = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      console.log(response);
      await updateProfile(response.user, {
        displayName: `${firstName} ${lastName}`,
      });

      const db = getFirestore();
      const userRef = doc(db, "users", response.user.uid);
      await setDoc(userRef, {
        userId: response.user.uid,
        quizzes: [],
      });
      const userDocId = userRef.id;
      console.log("User created:", userDocId);

      alert("Check Email");
    } catch (error) {
      console.error(error);
      alert("SignUp failed " + error.message);

      await updateProfileWithNames;
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
            placeholder="First Name"
            value={firstName}
            onChangeText={setFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder="Last Name"
            value={lastName}
            onChangeText={setLastName}
          />
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
              <View style={styles.btn}>
                <Button title="SignUp" color="firebrick" onPress={SignUp} />
              </View>
            </>
          )}
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
    top: 155,
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

export default SignUpScreen;
