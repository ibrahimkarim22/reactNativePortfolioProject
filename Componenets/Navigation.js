import { createStackNavigator } from "@react-navigation/stack";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItemList,
} from "@react-navigation/drawer";
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/LoginScreen";
import QuizScreen from "../screens/QuizScreen";
import Folger from "../screens/FolgerAPITest";
import FreeFolger from "../screens/Folger";
import ReadFolger from "../screens/Read";
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import CourseScreen from "../screens/CourseScreen";
import AboutScreen from "../screens/About";
import Lesson from "../screens/LessonScreen";
import { StyleSheet, View, Text, Platform } from "react-native";
import Constants from "expo-constants";
import { Image } from "react-native-elements";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { faHouseFlag } from "@fortawesome/free-solid-svg-icons";
import {
  NavigationContainer,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged, User } from "firebase/auth";
import { useEffect, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { auth } from "../firebaseConfig";


const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

const CustomDrawerContent = (props) => (
  <DrawerContentScrollView {...props} style={styles.sideDrawer}>
    <View style={styles.drawerSideLogo}>
      <View style={{ flex: 1 }}>
        <Image
          source={require("../assets/splash.png")}
          style={styles.drawerImage}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.drawerLogoText}>Shakespeare</Text>
      </View>
    </View>
    <DrawerItemList {...props} labelStyle={{ fontWeight: "bold" }} />
  </DrawerContentScrollView>
);

const Main = () => {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      console.log("user", user);
      if (user) {
        setUser(user);
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);
  return (
    <SafeAreaView style={styles.drawerContainer}>
      <Drawer.Navigator
        drawerContent={CustomDrawerContent}
        screenOptions={{
          headerStyle: { backgroundColor: "black" },
          headerTintColor: "white",
        }}
      >
        <Drawer.Screen
          name="Home"
          component={HomeScreen}
          options={{
            headerShown: true,
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="Course"
          component={CourseScreen}
          options={{
            title: "Course",
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
          <Drawer.Screen
          name="FreeFolger"
          component={FreeFolger}
          options={{
            title: "Free Folger",
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
              <Drawer.Screen
          name="About"
          component={AboutScreen}
          options={{
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        {!user && (
          <>
            <Drawer.Screen
              name="SignUp"
              component={SignUpScreen}
              options={{
                title: "Sign Up",
                drawerLabelStyle: { color: "white" },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? "peru" : "gray"}
                  />
                ),
              }}
            />
            <Drawer.Screen
              name="Login"
              component={LoginScreen}
              options={{
                headerShown: true,
                drawerLabelStyle: { color: "white" },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? "peru" : "gray"}
                  />
                ),
              }}
            />
          </>
        )}
      </Drawer.Navigator>
    </SafeAreaView>
  );
};

const Stacks = () => {
  

  const screenOptions = {
    headerTintColor: "white",
    headerStyle: { backgroundColor: "black" },
  };

  return (
    <View style={styles.stackContainer}>
      <Stack.Navigator screenOptions={screenOptions} initialRouteName="Root">
        <Stack.Screen
          name="Main"
          component={Main}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Lesson"
          component={Lesson}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="Quiz"
          component={QuizScreen}
          options={{ headerShown: true }}
        />

        <Stack.Screen
          name="Folger"
          component={Folger}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="MIT"
          component={MITFullPlayScreen}
          options={{
            title: "Play from MIT",
            headerShown: true,
          }}
        />
        <Stack.Screen
          name="Courses"
          component={CourseScreen}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="Root"
          component={RootScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          options={{ headerShown: true }}
        />
          <Stack.Screen
          name="ReadFolger"
          component={ReadFolger}
          options={{ headerShown: true }}
        />
      </Stack.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? 0 : Constants.statusBarHeight,
  },
  stackContainer: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? 0 : Constants.statusBarHeight,
  },
  drawerSideLogo: {
    backgroundColor: "maroon",
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    flexDirection: "column",
  },
  drawerLogoText: {
    color: "burlywood",
    fontSize: 24,
    fontWeight: "bold",
  },
  sideDrawer: {
    backgroundColor: "black",
  },
  drawerImage: {
    margin: 22,
    height: 100,
    width: 150,
  },
  stackIcon: {
    marginLeft: 10,
    color: "royalblue",
    fontSize: 24,
  },

  drawerIcon: {
    width: 55,
    borderRadius: 5,
    padding: 4,
    textAlign: "center",
  },
});

export default Stacks;
