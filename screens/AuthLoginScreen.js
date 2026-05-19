import {
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faCheck,
  faEnvelope,
  faLock,
  faRightToBracket,
} from "@fortawesome/free-solid-svg-icons";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useDispatch } from "react-redux";
import { setLevel } from "../Progress/CourseSlice";
import * as SecureStore from "expo-secure-store";
import FolgerMidsummer from "../assets/images/FolgerMidsummer.jpg";

const auth = FIREBASE_AUTH;

const AuthInput = ({ icon, ...props }) => (
  <View style={styles.inputWrap}>
    <FontAwesomeIcon icon={icon} size={15} color="#8f8474" />
    <TextInput
      {...props}
      placeholderTextColor="#8f8474"
      style={styles.input}
    />
  </View>
);

const AuthLoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);

  const dispatch = useDispatch();

  useEffect(() => {
    SecureStore.getItemAsync("userinfo").then((userdata) => {
      const userInfo = userdata ? JSON.parse(userdata) : null;
      if (userInfo) {
        setEmail(userInfo.email);
        setPassword(userInfo.password);
        setRemember(true);
      }
    });
  }, []);

  const Login = async () => {
    if (remember) {
      try {
        await SecureStore.setItemAsync(
          "userinfo",
          JSON.stringify({
            email,
            password,
          })
        );
      } catch (error) {
        console.log("Could not save user info", error);
      }
    } else {
      try {
        await SecureStore.deleteItemAsync("userinfo");
      } catch (error) {
        console.log("Could not delete user info", error);
      }
    }

    setLoading(true);
    try {
      const response = await signInWithEmailAndPassword(auth, email, password);
      const userRef = doc(FIRESTORE_DB, "users", response.user.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();

      if (userData?.completedLevel) {
        dispatch(setLevel(userData.completedLevel));
      }

      navigation.navigate("Main");
    } catch (error) {
      console.error(error);
      alert("Login failed " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground source={FolgerMidsummer} style={styles.background}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <View style={styles.overlay} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Welcome back</Text>
            <Text style={styles.title}>Continue your course.</Text>
            <Text style={styles.subtitle}>
              Pick up your progress, medals, and reading path.
            </Text>
          </View>

          <View style={styles.card}>
            <AuthInput
              icon={faEnvelope}
              placeholder="Email"
              value={email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              onChangeText={setEmail}
            />
            <AuthInput
              icon={faLock}
              placeholder="Password"
              value={password}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              onChangeText={setPassword}
              secureTextEntry
            />

            <Pressable
              onPress={() => setRemember(!remember)}
              style={styles.rememberRow}
            >
              <View style={[styles.checkbox, remember && styles.checkboxOn]}>
                {remember && (
                  <FontAwesomeIcon icon={faCheck} size={11} color="#120f0a" />
                )}
              </View>
              <Text style={styles.rememberText}>Remember me</Text>
            </Pressable>

            <Pressable
              onPress={Login}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                loading && styles.disabledButton,
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#130f0b" />
              ) : (
                <>
                  <FontAwesomeIcon
                    icon={faRightToBracket}
                    size={16}
                    color="#130f0b"
                  />
                  <Text style={styles.primaryButtonText}>Log in</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#050505",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.78)",
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  header: {
    marginBottom: 24,
  },
  eyebrow: {
    color: "#d8bd73",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  title: {
    color: "#fff8ef",
    fontSize: 36,
    fontWeight: "800",
    lineHeight: 40,
  },
  subtitle: {
    color: "#cfc6b8",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  card: {
    backgroundColor: "rgba(18, 18, 18, 0.94)",
    borderColor: "rgba(216, 189, 115, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 13,
    padding: 18,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: "#f1ece3",
    borderRadius: 8,
    flexDirection: "row",
    height: 56,
    paddingHorizontal: 16,
  },
  input: {
    color: "#16120e",
    flex: 1,
    fontSize: 16,
    marginLeft: 11,
  },
  rememberRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 34,
  },
  checkbox: {
    alignItems: "center",
    borderColor: "#6b6257",
    borderRadius: 5,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginRight: 10,
    width: 22,
  },
  checkboxOn: {
    backgroundColor: "#d8bd73",
    borderColor: "#d8bd73",
  },
  rememberText: {
    color: "#ded6c9",
    fontSize: 14,
    fontWeight: "600",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#d8bd73",
    borderRadius: 8,
    flexDirection: "row",
    gap: 9,
    height: 56,
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: "#130f0b",
    fontSize: 16,
    fontWeight: "800",
  },
});

export default AuthLoginScreen;
