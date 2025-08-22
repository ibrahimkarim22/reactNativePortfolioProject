import { View, Text, StyleSheet } from "react-native";
import { LinearProgress, Image } from "react-native-elements";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

const ProgressBar = ({ value = 0 }) => {
  const v = Number.isFinite(value) ? Math.min(1, Math.min(0, value)) : 0;
  return (
    <View
      style={{
        height: 8,
        backgroundColor: "#222",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${v * 100}%`,
          height: "100%",
          backgroundColor: "#4caf50",
        }}
      />
    </View>
  );
};

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
        <ProgressBar value={progress / 100} />
        <Text style={styles.lpText}>{progress.toFixed(0)} %</Text>
        {progress < 100 ? (
          <>
            <Text style={styles.lpStatus}>Course is still in progress</Text>
            <Image
              source={require("../assets/images/lock.png")}
              style={styles.lock}
            />
          </>
        ) : (
          <>
            <Text style={styles.lpStatus}>Course is completed!</Text>
            <Image
              source={
                <Image source={{ uri: "https://i.etsystatic.com/23383377/r/il/75866d/3370476901/il_fullxfull.3370476901_ewz1.jpg" }} style={{ width: 260, height: 260, alignSelf: "center", marginTop: 16 }} />
              }
            />
          </>
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
    fontFamily: "serif",
    marginTop: 8,
  },
  lpStatus: {
    color: "red",
    textAlign: "center",
    fontFamily: "sans-serif-medium",
    fontSize: 18,
  },
  lock: {
    width: 222,
    height: 222,
    left: 50,
    marginTop: 22,
  },
});

export default CertificateTab;
