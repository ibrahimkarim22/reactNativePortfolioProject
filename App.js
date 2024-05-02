import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Main from "./Componenets/Navigation";
import { initializeApp } from "@react-native-firebase/app"
import { useEffect } from "react";
import Stacks from "./Componenets/Navigation";


const App = () => {
  useEffect(() => {
    initializeApp();
  })
  return (
    <Provider store={store}>
     
      <Main />
   
    </Provider>
  );
};
export default App;
