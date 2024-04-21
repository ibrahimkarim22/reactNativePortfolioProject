import React from "react";
import AppNavigation from "./Componenets/DrawerNavigation";
import { Provider } from "react-redux";
import { store } from "./redux/store";


const App = () => {
  return (
    <Provider store={store}>
      <AppNavigation />
    </Provider>
  );
};
export default App;
