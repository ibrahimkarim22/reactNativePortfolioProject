import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import HTMLView from "react-native-htmlview";
import { useDispatch, useSelector } from "react-redux";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { ScrollView } from "react-native-gesture-handler";
import { aMidSummerNightsDream, allsWellThatEndsWell, antonyAndCleopatra } from "../shared/folgerUrl";

const HomeScreen = () => {
    const dispatch = useDispatch();
    const folgerState = useSelector((state) => state.folger);
    const [playNames, setPlayNames] = useState([]);

    useEffect(() => {
        const names = [
            allsWellThatEndsWell,
            antonyAndCleopatra,
            aMidSummerNightsDream,
        ];
        setPlayNames(names);

        names.forEach((playName) => {
            dispatch(fetchFolger(playName));
        });
    }, [dispatch]);

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.headerText}>Home Screen</Text>
            {folgerState.isLoading ? (
                <Text>Loading...</Text>
            ) : folgerState.errMess ? (
                <Text>Error: {folgerState.errMess}</Text>
            ) : (
                <View>
                    {playNames.map((playName) => (
                        <HTMLView
                            key={playName}
                            value={folgerState.htmlContent[playName]}
                            stylesheet={htmlStyles}
                        />
                    ))}
                </View>
            )}
        </ScrollView>
    );
};

const htmlStyles = StyleSheet.create({
    a: {
        fontWeight: "bold",
        color: "blue",
    },
    b: {
        fontWeight: "bold",
    },
    p: {
        color: 'red',
    }
});

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
