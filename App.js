import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Main from "./Componenets/Navigation";


const App = () => {
  return (
    <Provider store={store}>
      <NavigationContainer>
      <Main />
      </NavigationContainer>
    </Provider>
  );
};
export default App;
