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
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";

const SignUpScreen = () => {
  const navigation = useNavigation();
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
        photoURL:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
      });

      const db = FIRESTORE_DB;
      const userRef = doc(db, "users", response.user.uid);
      await setDoc(userRef, {
        userId: response.user.uid,
        completedLevel: 1,
        profileImage:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
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
      navigation.navigate("Main");
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
                <Button
                  title="SignUp"
                  color={"rgba(130, 0, 0, .7)"}
                  onPress={SignUp}
                />
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
    borderRadius: 22,
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
    shadowColor: "rgba(125, 0, 0, .9)",
    shadowOffset: { width: 3, height: 3 },
    shadowRadius: 33,
    elevation: 3,
  },
  btn: {
    margin: -7,
    padding: 16,
  },
});

export default SignUpScreen;
