import { View, Text, StyleSheet } from "react-native";
import { LinearProgress } from "react-native-elements";
import { useState } from "react";

const CertificateTab = () => {

    const [progress, setProgress] = useState(0);

    return (
        <View style={styles.main}>
            <View style={styles.usernameContainer}>
                <Text style={styles.username}>username</Text>
            </View>
            <View style={styles.lpContainer}>
            <LinearProgress 
                value={progress / 100}
                variant="outlined"
                color="primary"
                style={styles.lp}
            />
            <Text style={styles.lpText}>
                {progress} %
            </Text>
            <Text style={styles.lpStatus}>
                Course is still in progress
            </Text>
            </View>
            <View style={styles.fullNameContainer}>
                <Text style={styles.fullName}>
                    Full Name   
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    main: {
        flex: 1,
        backgroundColor: "black",
    },
    lpContainer: {
        margin: 33
    },
    lp: {
        marginTop: 22
    },
    lpText: {
        color: "white",
        fontSize: 18
    },
    lpStatus: {
        color: "red",
        textAlign: "center"
    },
    usernameContainer: {
        margin: 11,
        marginTop: 22
    },
    username: {
        color: "white",
        textAlign: "center"
    },
    fullNameContainer: {
        margin: 11
    },
    fullName: {
        color: "white",
        textAlign: "center",
        fontSize: 22
    }

});

export default CertificateTab;