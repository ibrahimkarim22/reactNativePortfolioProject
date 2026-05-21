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
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faEnvelope,
  faLock,
  faUser,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";
import { useDispatch } from "react-redux";
import { setLevel } from "../Progress/CourseSlice";
import FolgerMidsummer from "../assets/images/FolgerMidsummer.jpg";

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

const SignUpScreen = () => {
  const navigation = useNavigation();
  const dispatch = useDispatch();
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

      await updateProfile(response.user, {
        displayName: `${firstName} ${lastName}`.trim(),
        photoURL:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
      });

      const userRef = doc(FIRESTORE_DB, "users", response.user.uid);
      await setDoc(userRef, {
        userId: response.user.uid,
        completedLevel: 0,
        profileImage:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
      });
      dispatch(setLevel(0));

      alert("Welcome to BARD. Enjoy the journey.");
      navigation.navigate("Main");
    } catch (error) {
      console.error(error);
      alert("Sign up failed " + error.message);
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
            <Text style={styles.eyebrow}>Start the course</Text>
            <Text style={styles.title}>Create your BARD account.</Text>
            <Text style={styles.subtitle}>
              Save progress, unlock medals, and build toward your certificate.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.nameRow}>
              <View style={styles.nameField}>
                <AuthInput
                  icon={faUser}
                  placeholder="First"
                  value={firstName}
                  textContentType="givenName"
                  onChangeText={setFirstName}
                />
              </View>
              <View style={styles.nameField}>
                <AuthInput
                  icon={faUser}
                  placeholder="Last"
                  value={lastName}
                  textContentType="familyName"
                  onChangeText={setLastName}
                />
              </View>
            </View>
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
              textContentType="newPassword"
              onChangeText={setPassword}
              secureTextEntry
            />

            <Pressable
              onPress={SignUp}
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
                  <FontAwesomeIcon icon={faUserPlus} size={16} color="#130f0b" />
                  <Text style={styles.primaryButtonText}>Create account</Text>
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
  nameRow: {
    flexDirection: "row",
    gap: 10,
  },
  nameField: {
    flex: 1,
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

export default SignUpScreen;
