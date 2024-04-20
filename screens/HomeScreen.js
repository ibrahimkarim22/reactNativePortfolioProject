import { View, ScrollView, Text, StyleSheet, StatusBar, Image, Button } from "react-native";
import {
    createDrawerNavigator,
    DrawerContentScrollView,
    DrawerItemList
} from '@react-navigation/drawer';
import { useFonts } from "@expo-google-fonts/sora";
import { createStackNavigator } from "@react-navigation/stack";


const Drawer = createDrawerNavigator();

const screenOptions = {
    headerTransparent: true,
    headerTintColor: 'white'
}

const HomeNavigator = () => {
    const Stack = createStackNavigator();
    return (
        <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={({ navigation }) => ({
                    title: 'Home',
                })}
                ></Stack.Screen>
        </Stack.Navigator>
    )
};

const CustomDrawerContent = (props) => (
    <DrawerContentScrollView {...props}>
        <DrawerItemList />
    </DrawerContentScrollView>
)

const HomeScreen = () => { 
    const [fontsLoaded] = useFonts({
        Sora_500Medium,
      });
    
      if (!fontsLoaded) {
        return <Text>Loading...</Text>;
      }
    return(
        <View>
            <Drawer.Navigator
                initialRouteName="Home"
                drawerContent={CustomDrawerContent}
            >
                <Drawer.Screen
                    name="Home"
                    component={HomeNavigator}
                    options={{ title: 'Home' }}
                />
            </Drawer.Navigator>
        </View>
    )
}

export default HomeScreen;