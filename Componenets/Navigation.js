import { createStackNavigator } from "@react-navigation/stack";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
} from "@react-navigation/drawer";
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/AuthLoginScreen";
import QuizScreen from "../screens/QuizScreen";
import Folger from "../screens/FolgerAPITest";
import FreeFolger from "../screens/Folger";
import ReadFolger from "../screens/Read";
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import CourseScreen from "../screens/CourseScreen";
import AboutScreen from "../screens/AboutScreen";
import ContactScreen from "../screens/Contact";
import HowTo from "../screens/HowTo";
import Lesson from "../screens/LessonScreen";
import Synopsis from "../screens/JustSynopsis";
import SynopsisList from "../screens/SynopsisList";
import Performances from "../screens/Performances";
import { Pressable, StyleSheet, View, Text, Platform } from "react-native";
import Constants from "expo-constants";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faBarcode,
  faCrown,
  faEye,
  faFeather,
  faHouseFlag,
  faLightbulb,
  faRightToBracket,
  faUmbrella,
  faUserPlus,
  faWalkieTalkie,
} from "@fortawesome/free-solid-svg-icons";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

const drawerItems = [
  {
    name: "Home",
    label: "Home",
    description: "Profile and progress",
    icon: faHouseFlag,
  },
  {
    name: "Course",
    label: "Course",
    description: "Continue the path",
    icon: faCrown,
  },
  {
    name: "SynopsisList",
    label: "Synopsis",
    description: "Story summaries",
    icon: faBarcode,
  },
  {
    name: "FreeFolger",
    label: "Library",
    description: "Read the plays",
    icon: faFeather,
  },
  {
    name: "Performances",
    label: "Performances",
    description: "Stage and screen",
    icon: faStar,
  },
  {
    name: "HowTo",
    label: "Guide",
    description: "How BARD works",
    icon: faLightbulb,
  },
  {
    name: "About",
    label: "About",
    description: "The project",
    icon: faUmbrella,
  },
  {
    name: "Contact",
    label: "Contact",
    description: "Get in touch",
    icon: faWalkieTalkie,
  },
  {
    name: "SignUp",
    label: "Create account",
    description: "Start fresh",
    icon: faUserPlus,
    account: true,
  },
  {
    name: "Login",
    label: "Log in",
    description: "Resume progress",
    icon: faRightToBracket,
    account: true,
  },
];

const DrawerNavItem = ({ item, focused, navigation }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={focused ? { selected: true } : undefined}
    onPress={() => navigation.navigate(item.name)}
    style={({ pressed }) => [
      styles.drawerNavItem,
      focused && styles.drawerNavItemActive,
      pressed && styles.drawerNavItemPressed,
    ]}
  >
    <View
      style={[styles.drawerNavIcon, focused && styles.drawerNavIconActive]}
    >
      <FontAwesomeIcon
        icon={item.icon}
        size={16}
        color={focused ? "#0a0907" : "#d9bf72"}
      />
    </View>
    <View style={styles.drawerNavCopy}>
      <Text style={[styles.drawerNavLabel, focused && styles.drawerNavLabelActive]}>
        {item.label}
      </Text>
      <Text style={[styles.drawerNavMeta, focused && styles.drawerNavMetaActive]}>
        {item.description}
      </Text>
    </View>
    <View
      style={[styles.drawerNavSignal, focused && styles.drawerNavSignalActive]}
    />
  </Pressable>
);

const CustomDrawerContent = (props) => {
  const focusedRoute = props.state.routes[props.state.index]?.name;
  const routeNames = props.state.routeNames;
  const availableItems = drawerItems.filter((item) =>
    routeNames.includes(item.name)
  );
  const primaryItems = availableItems.filter((item) => !item.account);
  const accountItems = availableItems.filter((item) => item.account);

  return (
    <DrawerContentScrollView
      {...props}
      style={styles.sideDrawer}
      contentContainerStyle={styles.drawerContent}
    >
      <View style={styles.drawerBrand}>
        <View style={styles.drawerBrandTopline}>
          <Text style={styles.drawerBrandKicker}>BARD</Text>
          <View style={styles.drawerBrandRule} />
        </View>
        <Text style={styles.drawerBrandTitle}>Shakespeare Library</Text>
        <Text style={styles.drawerBrandSubtitle}>
          Local plays, course progress, and performance notes.
        </Text>
        <View style={styles.drawerBrandStats}>
          <View style={styles.drawerBrandStat}>
            <Text style={styles.drawerBrandStatValue}>38</Text>
            <Text style={styles.drawerBrandStatLabel}>plays</Text>
          </View>
          <View style={styles.drawerBrandDivider} />
          <View style={styles.drawerBrandStat}>
            <Text style={styles.drawerBrandStatValue}>100%</Text>
            <Text style={styles.drawerBrandStatLabel}>local</Text>
          </View>
        </View>
      </View>

      <Text style={styles.drawerSectionLabel}>Navigate</Text>
      <View style={styles.drawerNavGroup}>
        {primaryItems.map((item) => (
          <DrawerNavItem
            key={item.name}
            item={item}
            focused={focusedRoute === item.name}
            navigation={props.navigation}
          />
        ))}
      </View>

      {accountItems.length > 0 && (
        <>
          <Text style={styles.drawerSectionLabel}>Account</Text>
          <View style={styles.drawerNavGroup}>
            {accountItems.map((item) => (
              <DrawerNavItem
                key={item.name}
                item={item}
                focused={focusedRoute === item.name}
                navigation={props.navigation}
              />
            ))}
          </View>
        </>
      )}

      <View style={styles.drawerFooter}>
        <FontAwesomeIcon icon={faEye} size={14} color="#d9bf72" />
        <Text style={styles.drawerFooterText}>Offline-ready reading path</Text>
      </View>
    </DrawerContentScrollView>
  );
};

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
          drawerStyle: styles.drawerShell,
          sceneContainerStyle: styles.drawerScene,
          headerStyle: styles.drawerHeader,
          headerTintColor: "#f7f0df",
          headerTitleStyle: styles.drawerHeaderTitle,
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
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faCrown}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="SynopsisList"
          component={SynopsisList}
          options={{
            title: "Synopsis",
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faBarcode}
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
          name="Performances"
          component={Performances}
          options={{
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
          name="HowTo"
          component={HowTo}
          options={{
            title: "How To",
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faLightbulb}
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
    headerTintColor: "#f7f0df",
    headerStyle: { backgroundColor: "#050505" },
    headerTitleStyle: {
      fontWeight: "800",
    },
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
        <Stack.Screen
          name="Synopsis"
          component={Synopsis}
          options={{ headerShown: true }}
        />
      </Stack.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
    backgroundColor: "#050505",
    paddingTop: Platform.OS === "android" ? 0 : Constants.statusBarHeight,
  },
  stackContainer: {
    flex: 1,
    backgroundColor: "#050505",
    paddingTop: Platform.OS === "android" ? 0 : Constants.statusBarHeight,
  },
  drawerShell: {
    width: 318,
    backgroundColor: "#050505",
  },
  drawerScene: {
    backgroundColor: "#050505",
  },
  drawerHeader: {
    backgroundColor: "#050505",
    elevation: 0,
    shadowOpacity: 0,
    borderBottomColor: "#17130c",
    borderBottomWidth: 1,
  },
  drawerHeaderTitle: {
    color: "#f7f0df",
    fontWeight: "800",
  },
  sideDrawer: {
    backgroundColor: "#050505",
  },
  drawerContent: {
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  drawerBrand: {
    backgroundColor: "#12110f",
    borderColor: "#2b261b",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    marginBottom: 18,
  },
  drawerBrandTopline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  drawerBrandKicker: {
    color: "#d9bf72",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
  },
  drawerBrandRule: {
    flex: 1,
    height: 1,
    backgroundColor: "#3d321e",
  },
  drawerBrandTitle: {
    color: "#fbf5e7",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 28,
  },
  drawerBrandSubtitle: {
    color: "#a9a190",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  drawerBrandStats: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0a0a09",
    borderRadius: 8,
    borderColor: "#232016",
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 10,
  },
  drawerBrandStat: {
    flex: 1,
    alignItems: "center",
  },
  drawerBrandStatValue: {
    color: "#f4df9a",
    fontSize: 16,
    fontWeight: "900",
  },
  drawerBrandStatLabel: {
    color: "#817968",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "uppercase",
  },
  drawerBrandDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#282216",
  },
  drawerSectionLabel: {
    color: "#817968",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: "uppercase",
  },
  drawerNavGroup: {
    gap: 7,
    marginBottom: 18,
  },
  drawerNavItem: {
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#171715",
    backgroundColor: "#0c0c0b",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
  },
  drawerNavItemActive: {
    backgroundColor: "#e1c56f",
    borderColor: "#f0d889",
  },
  drawerNavItemPressed: {
    opacity: 0.82,
  },
  drawerNavIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#18150f",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  drawerNavIconActive: {
    backgroundColor: "rgba(10, 9, 7, 0.13)",
  },
  drawerNavCopy: {
    flex: 1,
    minWidth: 0,
  },
  drawerNavLabel: {
    color: "#f7f0df",
    fontSize: 14,
    fontWeight: "900",
  },
  drawerNavLabelActive: {
    color: "#0a0907",
  },
  drawerNavMeta: {
    color: "#7d7668",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  drawerNavMetaActive: {
    color: "#443817",
  },
  drawerNavSignal: {
    width: 5,
    height: 5,
    borderRadius: 5,
    backgroundColor: "transparent",
    marginLeft: 8,
  },
  drawerNavSignalActive: {
    backgroundColor: "#0a0907",
  },
  drawerFooter: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#242016",
    backgroundColor: "#0b0a08",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    gap: 9,
    marginTop: 4,
  },
  drawerFooterText: {
    color: "#a9a190",
    fontSize: 12,
    fontWeight: "800",
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
