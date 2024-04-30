import { View, Text, StyleSheet } from "react-native";
import { Fonts } from "../Componenets/fonts";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import UserInfoTab from "../tabs/UserInfoTab";
import MedalsTab from "../tabs/MedalsTab";
import CertificateTab from "../tabs/CertificateTab";

const Tab = createMaterialTopTabNavigator();

const HomeScreen = ({ navigation }) => {
  const fontsLoaded = Fonts();

  if (!fontsLoaded) {
    return <Text>Loading...</Text>;
  }
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "white",
        tabBarInactiveTintColor: "gray",
        tabBarLabelStyle: { fontSize: 16, fontWeight: "bold" },
        tabBarStyle: { backgroundColor: "black" },
      }}
    >
      <Tab.Screen name="UserInfo" component={UserInfoTab} />
      <Tab.Screen name="Medals" component={MedalsTab} />
      <Tab.Screen name="Certificate" component={CertificateTab} />
    </Tab.Navigator>
  );
};

export default HomeScreen;
