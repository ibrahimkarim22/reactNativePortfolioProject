import { useEffect, useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { Card } from "react-native-elements";
import { useDispatch, useSelector } from "react-redux";
import { fetchFolger } from "../folgerLibrary/folgerSlice";

const HomeScreen = () => {
    const dispatch = useDispatch();
    const folgerState = useSelector((state) => state.folger);

    useEffect(() => {
        dispatch(fetchFolger());
    }, [dispatch]);

    return (
        <View style={styles.container}>
        <Text style={styles.headerText}>Home Screen</Text>
        {folgerState.isLoading ? (
            <Text>Loading...</Text>
        ) : folgerState.errMess ? (
            <Text>Error: {folgerState.errMess}</Text>
        ) : (
            <View>
                <Text>Folger Data:</Text>
                {folgerState.folgerArray.map((item, index) => (
                    <Text key={index}>{item}</Text>
                ))}
            </View>
        )}
    </View>
);
};

const styles = StyleSheet.create({
container: {
    backgroundColor: "white",
    flex: 1,
    padding: 20,
},
headerText: {
    color: "white",
    fontSize: 24,
    marginBottom: 10,
},
});


export default HomeScreen;