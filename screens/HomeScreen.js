import React from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { View, Text, StyleSheet } from "react-native";
import { Fonts } from "../Componenets/fonts";
import UserInfoTab from "../tabs/UserInfoTab";
import  MedalsTab  from "../tabs/MedalsTab";
import  CertificateTab  from "../tabs/CertificateTab";


const Tab = createMaterialTopTabNavigator();

const HomeScreen = ({ navigation }) => {
  const fontsLoaded = Fonts();

  if (!fontsLoaded) {
    return <Text>Loading...</Text>;
  }
  return (
  
      <Tab.Navigator 
        tabBarOptions={{
          activeTintColor: "white",
          inactiveTintColor: "gray",
          labelStyle: { fontSize: 16, fontWeight: "bold"},
          style: { backgroundColor: "black"}
        }}
      >
        <Tab.Screen name="UserInfo" component={UserInfoTab} />
        <Tab.Screen name="Medals" component={MedalsTab} />
        <Tab.Screen name="Certificate" component={CertificateTab} />
      </Tab.Navigator>

  );
};


export default HomeScreen;
