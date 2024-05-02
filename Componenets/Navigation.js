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
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import CourseScreen from "../screens/CourseScreen";
import { Icon } from "react-native-elements";
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
  return (
    <SafeAreaView style={styles.drawerContainer}>
      <Drawer.Navigator
      
        initialRouteName="Login"
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
      </Drawer.Navigator>
    </SafeAreaView>
  );
};

const stacks = () => {
  const screenOptions = {
    headerTintColor: "white",
    headerStyle: { backgroundColor: "black" },
  };
  
  return (
    <NavigationContainer style={styles.stackContainer}>
      
      <Stack.Navigator screenOptions={screenOptions} >
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
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="Folger"
          component={Folger}
          options={{ headerShown: false }}
        />
         <Stack.Screen
          name="MIT"
          component={MITFullPlayScreen}
          options={{ headerShown: false }}
        />
          <Stack.Screen
          name="Courses"
          component={CourseScreen}
          options={{ headerShown: true }}
        />
      </Stack.Navigator>
      
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? 0 : Constants.statusBarHeight,
    marginTop: -55
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

export default stacks;
