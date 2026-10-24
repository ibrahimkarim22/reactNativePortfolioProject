import React from "react";
import { Provider } from "react-redux";
import { store, persistor } from "./redux/store";
import Stacks from "./Componenets/Navigation";
import { PersistGate } from "redux-persist/integration/react";
import { NavigationContainer } from "@react-navigation/native";

import { StatusBar } from "react-native";
// import { Text } from "react-native-elements";

import "./firebaseConfig";

const App = () => {
  return (
    <Provider store={store}>
      {/* <PersistGate loading={<Text>Loading...</Text>} persistor={persistor}> */}
      <PersistGate loading={null} persistor={persistor}>
        <NavigationContainer>
          <StatusBar backgroundColor="black" barStyle="light-content" />
          <Stacks />
        </NavigationContainer>
      </PersistGate>
    </Provider>
  );
};

export default App;
