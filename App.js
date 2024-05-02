import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Main from "./Componenets/Navigation";
import { initializeApp } from "@react-native-firebase/app"
import { useEffect } from "react";


const App = () => {
  useEffect(() => {
    initializeApp();
  })
  return (
    <Provider store={store}>
      <NavigationContainer>
      <Main />
      </NavigationContainer>
    </Provider>
  );
};
export default App;
