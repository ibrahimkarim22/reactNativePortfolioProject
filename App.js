import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { RootScreen } from "./screens/RootScreen";
import { Provider } from "react-redux";
import SignUpScreen from "./screens/SignUpScreen";
import LoginScreen from "./screens/LoginScreen";
import { color } from "react-native-elements/dist/helpers";

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Root">
        <Stack.Screen 
          name="Root" 
          component={RootScreen}  
          options={{ headerShown: false}}
        />
        <Stack.Screen 
          name="SignUp" 
          component={SignUpScreen}
          options={{ headerTransparent: true,  headerTintColor: 'white' }} 
         
        />
         <Stack.Screen 
          name="Login" 
          component={LoginScreen}
          options={{ headerTransparent: true,  headerTintColor: 'white' }} 
         
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
