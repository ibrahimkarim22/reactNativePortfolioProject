import {
  ImageBackground,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faBookOpen,
  faChevronRight,
  faFeather,
  faFilter,
  faMagnifyingGlass,
} from "@fortawesome/free-solid-svg-icons";
import { useNavigation } from "@react-navigation/native";
import { PLAYS } from "../shared/localPlayService";
import Loader from "../Componenets/Loader";

const genres = ["All", "Comedy", "Tragedy", "History", "Romance"];

const genreTone = {
  Comedy: {
    backgroundColor: "#173a2b",
    borderColor: "#2d7a58",
    color: "#9be1bd",
  },
  Tragedy: {
    backgroundColor: "#3b1618",
    borderColor: "#7e2a31",
    color: "#f0a0a7",
  },
  History: {
    backgroundColor: "#172d3f",
    borderColor: "#315f84",
    color: "#a8d3f3",
  },
  Romance: {
    backgroundColor: "#3b2438",
    borderColor: "#7c4c74",
    color: "#efb8df",
  },
};

const getGenreTone = (genre) =>
  genreTone[genre] || {
    backgroundColor: "#211c12",
    borderColor: "#3b321f",
    color: "#d8bd73",
  };

const FreeFolger = () => {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [heroLoaded, setHeroLoaded] = useState(false);

  const plays = useMemo(
    () =>
      PLAYS.slice().sort((a, b) =>
        String(a.name).localeCompare(String(b.name))
      ),
    []
  );
  const featuredPlay =
    plays.find((play) => play.id === "a-midsummer-nights-dream") || plays[0];
  const filteredPlays = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return plays.filter((play) => {
      const matchesGenre =
        selectedGenre === "All" || play.genre === selectedGenre;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        String(play.name).toLowerCase().includes(normalizedQuery) ||
        String(play.genre).toLowerCase().includes(normalizedQuery);

      return matchesGenre && matchesQuery;
    });
  }, [plays, query, selectedGenre]);
  const isCompact = width < 360;

  useEffect(() => {
    setHeroLoaded(false);
    const fallback = setTimeout(() => setHeroLoaded(true), 1200);
    return () => clearTimeout(fallback);
  }, [featuredPlay?.id]);

  const openPlay = (id) => {
    navigation.navigate("ReadFolger", { id });
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <ImageBackground
            source={featuredPlay?.mainImage}
            style={styles.heroImage}
            imageStyle={styles.heroImageStyle}
            onLoadStart={() => setHeroLoaded(false)}
            onLoad={() => setHeroLoaded(true)}
            onLoadEnd={() => setHeroLoaded(true)}
            onError={() => setHeroLoaded(true)}
          >
            {!heroLoaded && (
              <Loader label="Preparing library" compact overlay />
            )}
            <View style={styles.heroShade} />
            <View style={styles.heroContent}>
              <View style={styles.kickerRow}>
                <FontAwesomeIcon icon={faFeather} size={14} color="#d8bd73" />
                <Text style={styles.kicker}>Free Reading Library</Text>
              </View>
              <Text
                style={[styles.heroTitle, isCompact && styles.compactHeroTitle]}
                numberOfLines={2}
              >
                Complete plays, ready to read.
              </Text>
              <Text style={styles.heroSubtitle}>
                {plays.length} local texts across comedy, tragedy, history, and
                romance.
              </Text>
            </View>
          </ImageBackground>

          <View style={styles.heroStats}>
            <Metric value={plays.length} label="plays" />
            <Metric value="4" label="genres" />
            <Metric value="Local" label="source" />
          </View>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchBox}>
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              size={14}
              color="#8f8679"
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search plays"
              placeholderTextColor="#8f8679"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
        </View>

        <View style={styles.filterHeader}>
          <View style={styles.filterTitleRow}>
            <FontAwesomeIcon icon={faFilter} size={13} color="#d8bd73" />
            <Text style={styles.sectionTitle}>Browse</Text>
          </View>
          <Text style={styles.sectionMeta}>{filteredPlays.length} matches</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreScroller}
        >
          {genres.map((genre) => {
            const selected = selectedGenre === genre;
            return (
              <Pressable
                key={genre}
                onPress={() => setSelectedGenre(genre)}
                style={[styles.genreChip, selected && styles.genreChipActive]}
              >
                <Text
                  style={[
                    styles.genreChipText,
                    selected && styles.genreChipTextActive,
                  ]}
                >
                  {genre}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.libraryList}>
          {filteredPlays.length > 0 ? (
            filteredPlays.map((play) => (
              <LibraryCard
                key={play.id}
                play={play}
                isCompact={isCompact}
                onPress={() => openPlay(play.id)}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <FontAwesomeIcon icon={faBookOpen} size={22} color="#d8bd73" />
              <Text style={styles.emptyTitle}>No plays found</Text>
              <Text style={styles.emptyText}>
                Try another title or switch genre.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const Metric = ({ value, label }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const LibraryCard = ({ play, isCompact, onPress }) => {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const tone = getGenreTone(play.genre);

  useEffect(() => {
    setPosterLoaded(false);
    const fallback = setTimeout(() => setPosterLoaded(true), 1000);
    return () => clearTimeout(fallback);
  }, [play.id]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.libraryCard,
        pressed && styles.pressed,
      ]}
    >
      <ImageBackground
        source={play.mainImage}
        style={[styles.poster, isCompact && styles.compactPoster]}
        imageStyle={styles.posterImage}
        onLoadStart={() => setPosterLoaded(false)}
        onLoad={() => setPosterLoaded(true)}
        onLoadEnd={() => setPosterLoaded(true)}
        onError={() => setPosterLoaded(true)}
      >
        {!posterLoaded && <Loader label="Poster" compact overlay />}
        <View style={styles.posterShade} />
      </ImageBackground>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View
            style={[
              styles.genrePill,
              {
                backgroundColor: tone.backgroundColor,
                borderColor: tone.borderColor,
              },
            ]}
          >
            <Text style={[styles.genreText, { color: tone.color }]}>
              {play.genre || "Play"}
            </Text>
          </View>
          <Text style={styles.playIndex}>
            {String(play.difficulty).padStart(2, "0")}
          </Text>
        </View>
        <Text
          style={[styles.playTitle, isCompact && styles.compactPlayTitle]}
          numberOfLines={2}
        >
          {play.name}
        </Text>
        <View style={styles.cardFooter}>
          <View style={styles.readPill}>
            <FontAwesomeIcon icon={faBookOpen} size={12} color="#130f0b" />
            <Text style={styles.readPillText}>Read</Text>
          </View>
          <FontAwesomeIcon icon={faChevronRight} size={13} color="#8d8373" />
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: "#0d0d0c",
    borderBottomColor: "#242016",
    borderBottomWidth: 1,
  },
  heroImage: {
    height: 224,
    justifyContent: "flex-end",
  },
  heroImageStyle: {
    resizeMode: "cover",
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.62)",
  },
  heroContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  kickerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 9,
  },
  kicker: {
    color: "#d8bd73",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#fff8ef",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  compactHeroTitle: {
    fontSize: 29,
    lineHeight: 33,
  },
  heroSubtitle: {
    color: "#d8d0c2",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 8,
  },
  heroStats: {
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  metric: {
    backgroundColor: "#151514",
    borderColor: "#2c2924",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  metricValue: {
    color: "#fff8ef",
    fontSize: 18,
    fontWeight: "900",
  },
  metricLabel: {
    color: "#9e9485",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  searchSection: {
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#121211",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    height: 50,
    paddingHorizontal: 14,
  },
  searchInput: {
    color: "#fff8ef",
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 10,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  filterTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sectionTitle: {
    color: "#fff8ef",
    fontSize: 18,
    fontWeight: "900",
  },
  sectionMeta: {
    color: "#8f8679",
    fontSize: 12,
    fontWeight: "800",
  },
  genreScroller: {
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 13,
  },
  genreChip: {
    alignItems: "center",
    backgroundColor: "#121211",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    paddingHorizontal: 15,
  },
  genreChipActive: {
    backgroundColor: "#d8bd73",
    borderColor: "#d8bd73",
  },
  genreChipText: {
    color: "#aaa196",
    fontSize: 12,
    fontWeight: "900",
  },
  genreChipTextActive: {
    color: "#130f0b",
  },
  libraryList: {
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#10100f",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 160,
    justifyContent: "center",
    padding: 18,
  },
  emptyTitle: {
    color: "#fff8ef",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 12,
  },
  emptyText: {
    color: "#9e9485",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "center",
  },
  libraryCard: {
    backgroundColor: "#10100f",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 126,
    overflow: "hidden",
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  poster: {
    width: 108,
  },
  compactPoster: {
    width: 90,
  },
  posterImage: {
    resizeMode: "cover",
  },
  posterShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.12)",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    padding: 13,
  },
  cardTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  genrePill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  genreText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  playIndex: {
    color: "#5f574d",
    fontSize: 12,
    fontWeight: "900",
  },
  playTitle: {
    color: "#fff8ef",
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
    marginTop: 10,
  },
  compactPlayTitle: {
    fontSize: 16,
    lineHeight: 20,
  },
  cardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  readPill: {
    alignItems: "center",
    backgroundColor: "#d8bd73",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  readPillText: {
    color: "#130f0b",
    fontSize: 12,
    fontWeight: "900",
  },
});

export default FreeFolger;
