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
import ContactScreen from "../screens/Contact";
import Lesson from "../screens/LessonScreen";
import { StyleSheet, View, Text, Platform } from "react-native";
import Constants from "expo-constants";
import { Image } from "react-native-elements";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faFeather,
  faHouseFlag,
  faUmbrella,
  faWalkieTalkie,
} from "@fortawesome/free-solid-svg-icons";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged, User } from "firebase/auth";
import { useEffect, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";

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
        <Text style={styles.drawerLogoText}>BARD</Text>
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
                icon={faStar}
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
                icon={faFeather}
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
                icon={faUmbrella}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="Contact"
          component={ContactScreen}
          options={{
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faWalkieTalkie}
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
    backgroundColor: "rgba(128, 0, 0, .2)",
    height: 100,
    flex: 1,
    flexDirection: "row",
    alignContent: "center",
    alignItems: "center",
  },
  drawerLogoText: {
    color: "rgba(255, 250, 250, .7)",
    fontSize: 55,
    fontWeight: "bold",
    marginLeft: -70,
    textShadowColor: "rgba(255, 255, 255, .4)",
    textShadowOffset: { width: 0.2, height: 0.2 },
    textShadowRadius: 33,
  },
  sideDrawer: {
    backgroundColor: "black",
  },
  drawerImage: {
    margin: 22,
    height: 122,
    width: 200,
    marginLeft: 7,
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
