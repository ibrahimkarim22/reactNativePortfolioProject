import { View, Text, TextInput, Button, StyleSheet, ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { useState } from "react";
import { Card } from "react-native-elements";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";


const LoginScreen = ({ navigation }) => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const auth = FIREBASE_AUTH;
   
    const Login = async () => {
      setLoading(true);
      try {
        const response = await signInWithEmailAndPassword(auth, email, password);
        console.log(response);
      } catch (error) {
        console.error(error);
        alert("Login failed " + error.message)
      } finally {
        setLoading(false);
      }
    }

    const SignUp = async () => {
      setLoading(true);
      try {
        const response = await createUserWithEmailAndPassword(auth, email, password);
        console.log(response);
        alert("Check Email")
      } catch (error) {
        console.error(error);
        alert("SignUp failed " + error.message)
      } finally {
        setLoading(false);
      }
    }

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
           <Button
          title="Login"
          onPress={Login}
        />
           <Button
          title="Create account"
          onPress={SignUp}
        />
        </>
        )}
        <View style={styles.btn}>
       
        </View>
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
      backgroundColor: 'silver',
      alignContent: "center",
      margin: 23,
      top: 222,
      borderRadius: 33,
    },
    title: {
      color: "white",
      fontSize: 22,
      marginBottom: 12,
      textAlign: 'center',
      shadowColor: 'black',
      shadowOffset: { width: 1, height: 1 },
      shadowOpacity: 0.7,
      shadowRadius: 10,
      elevation: 5,
    },
    input: {
      backgroundColor: 'gainsboro',
      fontSize: 18,
      padding: 22,
      margin: 5,
      borderRadius: 222,
      shadowColor: 'steelblue',
      shadowOffset: { width: 1, height: 1 },
      shadowOpacity: 1,
      shadowRadius: 33,
      elevation: 5,
    },
    btn: {
      padding: 22,
    }
  });
  
  export default LoginScreen;