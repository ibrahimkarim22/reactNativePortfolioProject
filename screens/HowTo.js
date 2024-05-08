import React, { useState, useCallback} from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { HowToVideos } from "../shared/HowToRoot";

const HowTo = () => {
  const [playing, setPlaying] = useState(false);

  const onStateChange = useCallback((state) => {
    if (state === "ended") {
      setPlaying(false);
    }
  });
  return (
    <ScrollView style={styles.container}>
      <View>
        {HowToVideos.map((video, index) => (
          <YoutubePlayer
            key={index}
            height={300}
            play={playing}
            videoId={video.id}
            onChangeState={onStateChange}
          />
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
});

export default HowTo;
