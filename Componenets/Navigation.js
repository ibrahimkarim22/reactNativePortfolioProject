import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
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
import TestingMIT from "../screens/MITAPITest";
import Course from "../screens/CourseScreen";
import { Icon } from "react-native-elements";
import Lesson from "../screens/LessonScreen";
import { useDispatch } from "react-redux";
import { StyleSheet, View, Text, Platform } from "react-native";
import Constants from 'expo-constants';
import { Image } from "react-native-elements";


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
                    name="MIT API" 
                    component={TestingMIT}
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
        <DrawerContentScrollView {...props}>
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
                drawerStyle={{ backgroundColor: "black" }}
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
                        drawerIcon: ({ focused, size }) => (
                            <Icon
                                name="home"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={focused ? "red" : "blue"}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Course"
                    component={CourseNavigator}
                    options={{
                        title: "Course",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="list"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Lesson"
                    component={LessonNavigator}
                    options={{
                        title: "Lesson",
               
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="tree"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="Folger"
                    component={FolgerNavigator}
                    options={{
                        title: "Folger API",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="heart"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="MIT"
                    component={MITNavigator}
                    options={{
                        title: "MIT API",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="info-circle"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                 <Drawer.Screen
                    name="Root"
                    component={RootNavigator}
                    options={{
                        title: "Root Screen",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="info-circle"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                <Drawer.Screen
                    name="SignUp"
                    component={SignUpNavigator}
                    options={{
                        title: "Sign Up",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="address-card"
                                type="font-awesome"
                                size={24
                                }
                                iconStyle={{ width: 24 }}
                                color={color}
                            />
                        )
                    }}
                />
                  <Drawer.Screen
                    name="Login"
                    component={LoginNavigator}
                    options={{
                        title: "Login",
                        drawerIcon: ({ color }) => (
                            <Icon
                                name="address-card"
                                type="font-awesome"
                                size={24}
                                iconStyle={{ width: 24 }}
                                color={color}
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
        backgroundColor: "darkred",
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
    drawerImage: {
        margin: 22,
        height: 100,
        width: 150
    },
    stackIcon: {
        marginLeft: 10,
        color: "royalblue",
        fontSize: 24
    }
});

export default Main;