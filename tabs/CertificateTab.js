import { View, Text, StyleSheet } from "react-native";
import { LinearProgress, Image } from "react-native-elements";
import { useEffect, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { FIRESTORE_DB } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { useSelector } from "react-redux";

const CertificateTab = () => {
  const [progress, setProgress] = useState(0);
  const completedLevel = useSelector((state) => state.course.completedLevel);

  useEffect(() => {
    const calculateProgress = () => {
      const maxLevel = 38;
      const currentProgress = (completedLevel / maxLevel) * 100;
      setProgress(Math.min(currentProgress, 100));
    };
    calculateProgress();
  }, [completedLevel]);
  return (
    <View style={styles.main}>
      <View style={styles.lpContainer}>
        <LinearProgress
          value={progress / 100}
          variant="outlined"
          color="primary"
          style={styles.lp}
        />
        <Text style={styles.lpText}>{progress.toFixed(0)} %</Text>
        {progress < 100 ? (
    <>
        <Text style={styles.lpStatus}>Course is still in progress</Text>
        <Image
            source={require("../assets/images/lock.jpg")}
            style={styles.lock}
        />
    </>
) : (
    <Text style={styles.lpStatus}>Course is completed!</Text>
)}
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
    margin: 33,
  },
  lp: {
    marginTop: 22,
  },
  lpText: {
    color: "white",
    fontSize: 18,
  },
  lpStatus: {
    color: "red",
    textAlign: "center",
  },
  lock: {
    width: 222,
    height: 222,
  },
});

export default CertificateTab;
