import React, { useMemo, useRef, useState } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { PLAYS, getLocalPlayEntry } from '../shared/localPlayService';
import { SYNOPSIS_GENRES, filterSynopsisPlays } from '../shared/synopsisCatalogue';
import { CourseButton, CourseText, COURSE_COLORS } from '../course/CourseUI';

export default function SynopsisList() {
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('All');
  const scroll = useRef(null);
  const plays = useMemo(() => PLAYS.map(play => {
    const entry = getLocalPlayEntry(play.id);
    return { ...play, aliases: [entry?.code, entry?.play?.title, entry?.play?.fullTitle].filter(Boolean) };
  }), []);
  const visible = useMemo(() => filterSynopsisPlays(plays, query, genre), [plays, query, genre]);
  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const search = value => { setQuery(value); top(); };
  const chooseGenre = value => { setGenre(value); top(); };
  const open = play => { Keyboard.dismiss(); navigation.navigate('Synopsis', { id: play.id }); };

  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <View style={styles.controls}>
      <View style={styles.search}>
        <TextInput accessibilityLabel="Search plays" placeholder="Search play titles" placeholderTextColor={COURSE_COLORS.muted}
          value={query} onChangeText={search} onSubmitEditing={Keyboard.dismiss} returnKeyType="search"
          autoCorrect={false} autoCapitalize="none" allowFontScaling style={styles.input} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search"
          onPress={() => search('')} style={styles.clear}>
          <CourseText style={styles.clearText}>{'\u00d7'}</CourseText>
        </Pressable>}
      </View>
      <View accessibilityRole="tablist" accessibilityLabel="Filter by genre" style={styles.filters}>
        {SYNOPSIS_GENRES.map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value}
          accessibilityState={{ selected: genre === value }} onPress={() => chooseGenre(value)}
          style={[styles.filter, genre === value && styles.selectedFilter]}>
          <CourseText style={[styles.filterText, genre === value && styles.selectedText]}>{value}</CourseText>
        </Pressable>)}
      </View>
    </View>
    <ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.listContent}
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <CourseText tone="muted" style={styles.count} accessibilityLiveRegion="polite">
        {visible.length + (visible.length === 1 ? ' play' : ' plays')}
      </CourseText>
      {visible.map(play => <Pressable key={play.id} accessibilityRole="button"
        accessibilityLabel={play.name + ' synopsis'} accessibilityHint={'Read the ' + play.genre.toLowerCase() + ' synopsis.'}
        onPress={() => open(play)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Image source={play.mainImage} accessible={false} style={styles.cover} resizeMode="cover" resizeMethod="resize" />
        <View style={styles.rowCopy}>
          <CourseText style={styles.playTitle}>{play.name}</CourseText>
          <CourseText tone="muted" style={styles.genre}>{play.genre}</CourseText>
        </View>
        <CourseText accessible={false} style={styles.chevron}>{'\u203a'}</CourseText>
      </Pressable>)}
      {!visible.length && <View style={styles.empty}>
        <CourseText accessibilityRole="header" style={styles.emptyTitle}>No plays found</CourseText>
        <CourseText tone="muted">Try another title or genre.</CourseText>
        <CourseButton title="Clear search and filters" variant="quiet" onPress={() => { search(''); chooseGenre('All'); }} />
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COURSE_COLORS.background },
  controls: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12 },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COURSE_COLORS.border, borderRadius: 12, backgroundColor: COURSE_COLORS.panel },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, lineHeight: 24, color: COURSE_COLORS.text },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 24, lineHeight: 30, color: COURSE_COLORS.muted },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filter: { minHeight: 44, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 10, justifyContent: 'center' },
  selectedFilter: { backgroundColor: '#29251c' },
  filterText: { fontSize: 14, lineHeight: 22, color: COURSE_COLORS.muted },
  selectedText: { color: '#e1c98e', fontWeight: '600' },
  list: { flex: 1 },
  listContent: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 24 },
  count: { fontSize: 13, lineHeight: 20, paddingTop: 2, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2c2b28', minHeight: 100 },
  pressed: { backgroundColor: '#1b1c1e' },
  cover: { width: 54, height: 72, borderRadius: 5, backgroundColor: COURSE_COLORS.panel },
  rowCopy: { flex: 1, minWidth: 0, gap: 5 },
  playTitle: { fontSize: 17, lineHeight: 25, fontWeight: '600' },
  genre: { fontSize: 13, lineHeight: 20 },
  chevron: { fontSize: 25, lineHeight: 32, color: COURSE_COLORS.gold },
  empty: { gap: 12, paddingTop: 28, paddingBottom: 28 },
  emptyTitle: { fontSize: 21, lineHeight: 30, fontWeight: '600' },
});
