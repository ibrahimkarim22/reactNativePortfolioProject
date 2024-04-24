import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createStackNavigator } from "@react-navigation/stack";
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/LoginScreen";
import Folger from "../screens/FolgerAPITest";
import TestingMIT from '../screens/MITAPITest';


const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

const AppNavigation = () => {
  return (
    <NavigationContainer>
      <Drawer.Navigator 
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: 'black',
          },
            headerTintColor: 'white', 
            headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}  
      >
        <Drawer.Screen name="Home" component={HomeScreen} />
        <Drawer.Screen name="Folger API" component={Folger} />
        <Drawer.Screen name="MIT API" component={TestingMIT} />
        <Drawer.Screen name="Root" component={RootScreen} />
        <Drawer.Screen name="Sign Up" component={SignUpScreen} />
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
            name="Folger API" 
            component={Folger}
        />
          <Stack.Screen 
            name="MIT API" 
            component={TestingMIT}
        />
      <Stack.Screen 
        name="Root" 
        component={RootScreen} 
       

    />
      <Stack.Screen
        name="Sign Up"
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
