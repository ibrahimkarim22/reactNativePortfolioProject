import { createStackNavigator } from "@react-navigation/stack";
import {
    createDrawerNavigator,
    DrawerContentScrollView,
    DrawerItemList
} from '@react-navigation/drawer';
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/LoginScreen";
import Folger from "../screens/FolgerAPITest";
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import Course from "../screens/CourseScreen";
import { Icon } from "react-native-elements";
import Lesson from "../screens/LessonScreen";
import { StyleSheet, View, Text, Platform } from "react-native";
import Constants from 'expo-constants';
import { Image } from "react-native-elements";
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faHouseFlag } from '@fortawesome/free-solid-svg-icons';


const Drawer = createDrawerNavigator();

const screenOptions = {
    headerTintColor: "white",
    headerStyle: { backgroundColor: "black"}
}

const HomeNavigator = () => {
    const Stack = createStackNavigator();    
    return (
      <Stack.Navigator screenOptions={screenOptions} >
        <Stack.Screen 
            name="Home" 
            component={HomeScreen} 
            options={({ navigation }) => ({
                title: "Home",
                headerShown: false,
                headerLeft: () => (
                    <Icon 
                        name="home"
                        type="font-awesome"
                        iconStyle={styles.stackIcon}
                        onPress={() => navigation.toggleDrawer()}
                    />
                )
                })}
            />
            </Stack.Navigator>
            );
        };
    const CourseNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Course" 
                    component={Course}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };

    const LessonNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Lesson" 
                    component={Lesson}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };

    const FolgerNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Folger API" 
                    component={Folger}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };
  
    const MITNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="MIT Full Play" 
                    component={MITFullPlayScreen}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };

    const RootNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Root" 
                    component={RootScreen}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };

    const SignUpNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Sign Up" 
                    component={SignUpScreen}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };

    const LoginNavigator = () => {
        const Stack = createStackNavigator();
        return(
            <Stack.Navigator screenOptions={screenOptions}>
                <Stack.Screen 
                    name="Login" 
                    component={LoginScreen}
                    options={({ navigation }) => ({
                        headerShown: false,
                        headerLeft: () => (
                            <Icon
                            name="info-circle"
                            type="font-awesome"
                            iconStyle={styles.stackIcon}
                            onPress={() => navigation.toggleDrawer()}
                            />
                        )
                    })}
                />
            </Stack.Navigator>
        );
    };
    const CustomDrawerContent = (props) => (
        <DrawerContentScrollView {...props} style={styles.sideDrawer}>
            <View style={styles.drawerHeader}>
                <View style={{ flex: 1 }}>
                    <Image source={require("../assets/splash.png")} style={styles.drawerImage} />
                </View>
                <View style={{ flex: 2 }}>
                    <Text style={styles.drawerHeaderText}>Shakespeare</Text>
                </View>
            </View>
            <DrawerItemList {...props} labelStyle={{ fontWeight: "bold" }} />
        </DrawerContentScrollView>
    );

    const Main = () => {
        return (
            <View
            style={{
                flex: 1,
                paddingTop:
                    Platform.OS === "ios" ? 0 : Constants.statusBarHeight
            }}
        >
            <Drawer.Navigator
                initialRouteName="Home"
                drawerContent={CustomDrawerContent}
                screenOptions={{
                    headerStyle: { backgroundColor: "black"},
                    headerTintColor: "white",
                }}
            >
                <Drawer.Screen
                    name="Home"
                    component={HomeNavigator}
                    options={{
                        title: "Home",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                                style={styles.drawerIcon}
                                size={28}            
                                color={focused ? "peru" : "gray"}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Course"
                    component={CourseNavigator}
                    options={{
                        title: "Course",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Lesson"
                    component={LessonNavigator}
                    options={{
                        title: "Lesson",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                                style={styles.drawerIcon}
                                size={28}            
                                color={focused ? "peru" : "gray"}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Folger"
                    component={FolgerNavigator}
                    options={{
                        title: "Folger API",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
                <Drawer.Screen
                    name="MITFullPlay"
                    component={MITNavigator}
                    options={{
                        title: "MIT Full Play",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
                 <Drawer.Screen
                    name="Root"
                    component={RootNavigator}
                    options={{
                        title: "Root Screen",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
                <Drawer.Screen
                    name="SignUp"
                    component={SignUpNavigator}
                    options={{
                        title: "Sign Up",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
                  <Drawer.Screen
                    name="Login"
                    component={LoginNavigator}
                    options={{
                        title: "Login",
                        drawerLabelStyle: { color: "white"},
                        drawerIcon: ({ focused }) => (
                            <FontAwesomeIcon icon={faHouseFlag} 
                            style={styles.drawerIcon}
                            size={28}            
                            color={focused ? "peru" : "gray"}
                        />
                        )
                    }}
                />
            </Drawer.Navigator>
        </View>
    );
};

const styles = StyleSheet.create({
    drawerHeader: {
        backgroundColor: "maroon",
        height: 100,
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        flexDirection: "column"
    },
    drawerHeaderText: {
        color: "burlywood",
        fontSize: 24,
        fontWeight: "bold"
    },
    sideDrawer: {
        backgroundColor: "black"
    },
    drawerImage: {
        margin: 22,
        height: 100,
        width: 150
    },
    stackIcon: {
        marginLeft: 10,
        color: "royalblue",
        fontSize: 24
    },
    
 drawerIcon: {
    width: 55,  
    borderRadius: 5,
    padding: 4,
    textAlign: "center"
    },
    
});

export default Main;