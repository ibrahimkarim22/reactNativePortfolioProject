import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMyHighlightsCatalogue } from '../reader/useMyHighlights';
import { THEMES } from '../reader/readerConstants';
import HighlightStorageStatus from '../reader/HighlightStorageStatus';

export default function MyHighlightsScreen() {
  const navigation = useNavigation();
  const { owner, rows, loading, error, refreshReadOnly, storageStatus } = useMyHighlightsCatalogue();
  if (!owner.ready) return <View style={styles.state}><ActivityIndicator color={THEMES.night.highlightAction} /><Text style={styles.detail}>Loading sign-in…</Text></View>;
  if (!owner.uid) return <View style={styles.state}><Text accessibilityRole="header" style={styles.title}>Sign in to see your highlights</Text><Text style={styles.detail}>Your saved highlights remain on this device when you sign out.</Text></View>;
  const empty = <View style={styles.state}>
    {loading ? <><ActivityIndicator color={THEMES.night.highlightAction} /><Text style={styles.detail}>Loading saved highlights…</Text></> :
      error ? <Text accessibilityRole="alert" style={styles.detail}>Highlights could not be loaded. Your saved data has been retained.</Text> :
        <><Text style={styles.title}>Your passages, together</Text><Text style={styles.detail}>Select a passage in a play, then choose Highlight. Saved passages will appear here.</Text></>}
  </View>;
  return <View style={styles.screen}>
    <FlatList key={owner.generation} data={rows} keyExtractor={item => item.workKey} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      contentContainerStyle={styles.content} ListEmptyComponent={empty}
      ListHeaderComponent={<View style={styles.header}>
        <HighlightStorageStatus theme={THEMES.night} {...storageStatus} />
        {!!error && <View><Text accessibilityRole="alert" style={styles.detail}>Highlights could not be loaded completely. Retry reading without changing saved data.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry reading highlights" onPress={refreshReadOnly} style={({pressed})=>[styles.button,pressed&&styles.pressed]}><Text style={styles.buttonLabel}>Retry reading</Text></Pressable></View>}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.countLabel}${item.available ? '' : ', unavailable play'}`}
        accessibilityHint="Open saved passages for this play" style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        onPress={() => navigation.push('PlayHighlights', { workKey: item.workKey, ownerGeneration: owner.generation })}>
        <Text style={styles.playTitle}>{item.title}</Text>
        <Text style={styles.count}>{item.countLabel}</Text>
        {!item.available && <Text style={styles.detail}>Saved entries are retained. Their play is unavailable in the current local library.</Text>}
        {!!(item.readError || item.error) && <Text style={styles.detail}>Storage needs attention. Open this play for details.</Text>}
        <Text style={styles.open}>View passages ›</Text>
      </Pressable>} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050505' },
  content: { paddingHorizontal: 18, paddingBottom: 30 },
  header: { paddingTop: 12, paddingBottom: 12 },
  title: { color: '#fff8ef', fontSize: 26, lineHeight: 34, fontWeight: '800', marginBottom: 12 },
  detail: { color: '#b9b0a2', fontSize: 15, lineHeight: 23, marginBottom: 12 },
  state: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', padding: 24, gap: 12 },
  card: { backgroundColor: '#10100f', borderColor: '#292722', borderRadius: 8, borderWidth: 1, padding: 18, marginBottom: 12 },
  pressed: { backgroundColor: THEMES.night.highlightPressed },
  playTitle: { color: '#fff8ef', fontSize: 21, lineHeight: 29, fontWeight: '800', marginBottom: 9 },
  count: { color: THEMES.night.secondary, fontSize: 15, lineHeight: 23, fontWeight: '700', marginBottom: 9 },
  open: { color: THEMES.night.highlightAction, fontSize: 15, lineHeight: 23, fontWeight: '700' },
  button: { borderWidth: 1, borderColor: THEMES.night.border, borderRadius: 8, minHeight: 48, justifyContent: 'center', padding: 12, marginBottom: 12 },
  buttonLabel: { color: THEMES.night.highlightAction, fontSize: 16, lineHeight: 24, fontWeight: '700' },
});
