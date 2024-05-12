import React from "react";
import { StatusBar } from "react-native";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Provider } from "react-redux";
import { store, persistor } from "./redux/store";
import Stacks from "./Componenets/Navigation";
import { initializeApp } from "@react-native-firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { FIREBASE_APP, FIREBASE_AUTH, firebaseConfig } from "./firebaseConfig";
import { PersistGate } from "redux-persist/integration/react";
import { Text } from "react-native-elements";
import { NavigationContainer } from "@react-navigation/native";

const App = () => {
  return (
    <Provider store={store}>
      <PersistGate loading={<Text>Loading...</Text>} persistor={persistor}>
        <NavigationContainer>
          <StatusBar backgroundColor="black" barStyle="light-content" />
          <Stacks />
        </NavigationContainer>
      </PersistGate>
    </Provider>
  );
};

export default App;
