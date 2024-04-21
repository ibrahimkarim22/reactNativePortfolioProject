import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createStackNavigator } from "@react-navigation/stack";
import { RootScreen } from "../screens/RootScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

const AppNavigation = () => {
  return (
    <NavigationContainer>
      <Drawer.Navigator initialRouteName="Home">
        <Drawer.Screen name="Home" component={StackNavigator} />
        <Drawer.Screen name="Root" component={RootScreen} />
        <Drawer.Screen name="SignUp" component={SignUpScreen} />
        <Drawer.Screen name="Login" component={LoginScreen} />
      </Drawer.Navigator>
    </NavigationContainer>
  );
};

const StackNavigator = () => {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
    >
        <Stack.Screen 
            name="Home" 
            component={HomeScreen}
        />
      <Stack.Screen 
        name="Root" 
        component={RootScreen} 

    />
      <Stack.Screen
        name="SignUp"
        component={SignUpScreen}
        options={{ headerTransparent: true, headerTintColor: "white" }}
      />
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ headerTransparent: true, headerTintColor: "white" }}
      />
    </Stack.Navigator>
  );
};

export default AppNavigation;
