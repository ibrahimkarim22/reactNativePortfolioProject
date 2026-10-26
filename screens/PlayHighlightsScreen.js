import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useMyHighlightsWork } from '../reader/useMyHighlights';
import { normalMyHighlightsHandoff } from '../reader/normalHighlightStore';
import { errorMessage } from '../reader/readerHighlights';
import { THEMES } from '../reader/readerConstants';
import ReaderHighlightsModal from '../reader/ReaderHighlightsModal';
import ReaderHighlightPicker from '../reader/ReaderHighlightPicker';
import useReaderModalFocus from '../reader/useReaderModalFocus';
import HighlightEntry from '../reader/HighlightEntry';
import HighlightOptionsModal from '../reader/HighlightOptionsModal';
import { syncErrorText } from '../reader/highlightSyncPresentation';

export default function PlayHighlightsScreen({ route }) {
  const navigation = useNavigation();
  const state = useMyHighlightsWork(route?.params);
  const { owner, validOwner, play, items, store, workId, snapshot, loading, error, refreshReadOnly, mutate, retryPending, isCurrent,
    synchronizationError, syncSummary, activateWork } = state;
  const [quotation, setQuotation] = useState(null);
  const [draft, setDraft] = useState(null);
  const [color, setColor] = useState('yellow');
  const [removing, setRemoving] = useState(null);
  const [pending, setPending] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [options, setOptions] = useState(null);
  const operation = useRef(0), focused = useRef(true), transferring = useRef(false);
  const buttonTargets = useRef(new Map()), heading = useRef(null);
  const busy = validOwner && pending?.generation === owner.generation;
  const selected = validOwner && quotation?.generation === owner.generation ? items.find(item => item.id === quotation.id) : null;
  const editing = validOwner && draft?.generation === owner.generation ? items.find(item => item.id === draft.id && item.record?.revision === draft.revision && item.status === 'resolved') : null;
  const focus = useReaderModalFocus({ visible: !!selected || !!editing });
  const optionsItem = validOwner && options?.generation === owner.generation ? items.find(item => item.id === options.id) : null;
  const optionsFocus = useReaderModalFocus({ visible: !!optionsItem });
  const storageError = error || snapshot.error;
  const readFailure = error || snapshot.readError || (!snapshot.writeBlocked ? snapshot.error : null);
  const writeFailure = snapshot.writeBlocked ? snapshot.error : null;
  const message = validOwner && actionError?.generation === owner.generation ? actionError.message : null;
  const accountError = syncErrorText(synchronizationError) || syncSummary;
  const blocked = !!storageError || busy || snapshot.saving || loading;
  const stillCurrent = token => focused.current && isCurrent() && operation.current === token;
  const abandonDraft = () => { if (snapshot.writeBlocked && (draft || removing)) store?.abandonPendingIntent?.(); };
  const close = () => { if (busy) return; abandonDraft(); operation.current++; setQuotation(null); setDraft(null); setRemoving(null); setActionError(null); focus.restoreAfterClose(); };
  useEffect(() => { operation.current++; setQuotation(null); setDraft(null); setRemoving(null); setPending(null); setActionError(null); setOptions(null); focus.cancel(); optionsFocus.cancel(); }, [owner.uid, owner.generation]);
  useLayoutEffect(() => {
    const title = play?.name || 'Saved highlights';
    navigation.setOptions({ title, headerStyle: { backgroundColor: '#050505' }, headerTintColor: '#fff8ef',
      headerTitle: ({ tintColor, style, onLayout }) => <Text
        ref={node => {
          const previous = heading.current;
          heading.current = node;
          if (!focus.triggerRef.current || focus.triggerRef.current === previous) focus.triggerRef.current = node;
        }}
        accessible accessibilityRole="header" accessibilityLabel={title} allowFontScaling numberOfLines={1}
        onLayout={onLayout} style={[styles.navigationTitle, style, { color: tintColor || '#fff8ef' }]}>{title}</Text> });
  }, [navigation, play?.name, focus.triggerRef]);
  useFocusEffect(useCallback(() => {
    focused.current = true; transferring.current = false;
    activateWork?.().catch(() => {});
    return () => { focused.current = false; operation.current++; setQuotation(null); setDraft(null); setRemoving(null); setPending(null); setOptions(null); focus.cancel(); optionsFocus.cancel(); if (!transferring.current) normalMyHighlightsHandoff.cancel(); };
  }, [owner.generation, activateWork]));
  const run = async (action, after) => {
    if (busy || !isCurrent()) return;
    const token = ++operation.current;
    setPending({ generation: owner.generation, token }); setActionError(null);
    try { const result = await action(); if (stillCurrent(token)) { setPending(null); after?.(result); } }
    catch (failure) { if (stillCurrent(token)) setActionError({ generation: owner.generation, message: errorMessage(failure.code) }); }
    finally { if (stillCurrent(token)) setPending(null); }
  };
  const show = item => {
    if (blocked || item.status !== 'resolved') return;
    run(() => normalMyHighlightsHandoff.prepare({ store, workId, recordId: item.id, expectedRevision: item.record.revision }), request => {
      transferring.current = true;
      setQuotation(null); focus.cancel();
      navigation.push('ReadFolger', { id: workId, openHighlight: request });
    });
  };
  const edit = item => { if (blocked || item.status !== 'resolved') return; setQuotation(null); setRemoving(null); setDraft({ id: item.id, revision: item.record.revision, generation: owner.generation }); setColor(item.colorId); setActionError(null); };
  const requestRemove = item => { if (blocked) return; setDraft(null); setQuotation({ id: item.id, generation: owner.generation }); setRemoving(item.id); setActionError(null); };
  const confirmRemove = () => { if (!selected || removing !== selected.id || blocked) return; run(() => mutate('remove', selected.id), () => { focus.triggerRef.current = heading.current; close(); }); };
  const saveColor = () => { if (!editing || blocked) return; run(() => mutate('recolor', editing.id, color), () => { setDraft(null); focus.restoreAfterClose(); }); };
  const button = (label, action, disabled = false, text = label) => <Pressable key={label}
    ref={node => { const previous = buttonTargets.current.get(label); if (node) buttonTargets.current.set(label, node); else { buttonTargets.current.delete(label); if (focus.triggerRef.current === previous) focus.triggerRef.current = heading.current; } }}
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { if (!disabled) { focus.triggerRef.current = buttonTargets.current.get(label) || heading.current; action(); } }}
    style={({pressed})=>[styles.button,{backgroundColor:pressed&&!disabled?THEMES.night.highlightPressed:'transparent'}]}><Text style={[styles.buttonLabel,{color:disabled?THEMES.night.highlightActionDisabled:THEMES.night.highlightAction}]}>{text}</Text></Pressable>;
  if (!owner.ready) return <View style={styles.state}><ActivityIndicator color={THEMES.night.highlightAction} /><Text style={styles.detail}>Loading sign-in…</Text></View>;
  if (!owner.uid) return <View style={styles.state}><Text style={styles.title}>Sign in to see your highlights</Text></View>;
  if (!validOwner) return <View style={styles.state}><Text accessibilityRole="alert" style={styles.detail}>This list belongs to an earlier sign-in. Return to My Highlights to open the current account’s saved passages.</Text>{button('Back to highlights', () => navigation.goBack())}</View>;
  return <View style={styles.screen}>
    <View style={styles.screen} accessibilityElementsHidden={!!selected || !!editing || !!optionsItem} importantForAccessibility={selected || editing || optionsItem ? 'no-hide-descendants' : 'auto'}>
    <FlatList data={items} keyExtractor={item => item.id} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5}
      contentContainerStyle={styles.content} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      ListHeaderComponent={<View style={styles.header}>
        {!!readFailure && <View><Text accessibilityRole="alert" style={styles.detail}>Highlights could not be loaded.</Text>{button('Retry reading highlights', refreshReadOnly, busy, 'Try again')}</View>}
        {!!writeFailure && <View><Text accessibilityRole="alert" style={styles.detail}>{errorMessage(writeFailure.code)}</Text>{button('Retry pending highlight change', () => run(retryPending), busy || loading, 'Retry save')}</View>}
        {!!accountError && <Text accessibilityRole="alert" style={styles.detail}>{accountError}</Text>}
        {!!message && <Text accessibilityRole="alert" style={styles.detail}>{message}</Text>}
      </View>}
      ListEmptyComponent={<View style={styles.state}>{loading ? <><ActivityIndicator color={THEMES.night.highlightAction} /><Text style={styles.detail}>Loading highlights…</Text></> : error ? <Text style={styles.detail}>Retry reading to load this play’s saved entries.</Text> : <Text style={styles.detail}>No saved highlights in this play. Select a passage in the reader, then choose Highlight.</Text>}</View>}
      renderItem={({ item, index }) => <View style={styles.card}>
        <HighlightEntry item={item} index={index} theme={THEMES.night} disabled={blocked} saving={busy || snapshot.saving}
          onTrigger={node => { focus.triggerRef.current = node || heading.current; optionsFocus.triggerRef.current = node || heading.current; }}
          onShow={() => show(item)}
          onFullQuote={() => { setQuotation({ id: item.id, generation: owner.generation }); setRemoving(null); setActionError(null); }}
          onOptions={item.retainedDeletion ? undefined : () => setOptions({ id: item.id, generation: owner.generation })} />
        {item.syncConflict && <View>
          <Text accessibilityRole="alert" style={styles.detail}>{item.syncDeletion ? 'This highlight was removed on another device. Keep the removal, or select the passage again to save a new highlight.'
            : item.retainedDeletion ? 'This highlight changed on another device after you removed it. Restore it to review the change before removing it again.'
              : 'This highlight has a different color on another device. Choose which color to keep.'}</Text>
          {button((item.syncDeletion ? 'Keep removal ' : item.retainedDeletion ? 'Restore highlight ' : 'Use other color ') + (index + 1), () => run(() => mutate('resolveConflict', item.id, 'use-cloud')), blocked)}
          {!item.syncDeletion && !item.retainedDeletion && button('Keep this color ' + (index + 1), () => run(() => mutate('resolveConflict', item.id, 'reapply-local')), blocked)}
        </View>}
      </View>} />
    </View>
    <HighlightOptionsModal visible={!!optionsItem} theme={THEMES.night} canEdit={optionsItem?.status === 'resolved'} disabled={blocked}
      onClose={() => { optionsFocus.restoreAfterClose(); setOptions(null); }} onDismiss={optionsFocus.onDismiss}
      onEdit={() => { const item = optionsItem; optionsFocus.cancel(); setOptions(null); if (item) edit(item); }}
      onRemove={() => { const item = optionsItem; optionsFocus.cancel(); setOptions(null); if (item) requestRemove(item); }} />
    <ReaderHighlightsModal visible={!!selected} fullQuotation items={selected ? [selected] : []} theme={THEMES.night} saving={busy || snapshot.saving}
      syncError={accountError} onResolveSync={(id, choice) => run(() => mutate('resolveConflict', id, choice))}
      error={message || (storageError ? errorMessage(storageError.code) : null)}
      retryLabel="Retry reading highlights" onRetry={readFailure ? refreshReadOnly : undefined}
      onRetryPending={writeFailure ? () => run(retryPending) : undefined}
      removingId={selected?.id === removing ? removing : null} onRequestRemove={() => requestRemove(selected)}
      onCancelRemove={() => { abandonDraft(); setRemoving(null); setActionError(null); }} onConfirmRemove={confirmRemove}
      onShow={() => show(selected)} onEdit={() => edit(selected)} onClose={close} onDismiss={focus.onDismiss} />
    <ReaderHighlightPicker visible={!!editing} snapshot={editing ? { selection: editing.record.selectionRef } : undefined} colorId={color} theme={THEMES.night}
      saving={busy || snapshot.saving} error={message || (storageError ? errorMessage(storageError.code) : null)} onColor={setColor}
      notice={readFailure ? 'Highlights could not be loaded. Close this view and try again.' : undefined}
      onSave={saveColor} onClose={close} onDismiss={focus.onDismiss} onRetry={writeFailure ? () => run(retryPending, () => { setDraft(null); focus.restoreAfterClose(); }) : undefined} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050505' }, content: { paddingHorizontal: 18, paddingBottom: 30 },
  header: { paddingTop: 16, paddingBottom: 0 }, title: { color: '#fff8ef', fontSize: 25, lineHeight: 33, fontWeight: '800', marginBottom: 12 },
  navigationTitle: { fontSize: 20, fontWeight: '800' },
  detail: { color: '#b9b0a2', fontSize: 15, lineHeight: 23, marginBottom: 12 }, state: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', padding: 24, gap: 12 },
  card: { backgroundColor: '#10100f', borderColor: '#292722', borderRadius: 8, borderWidth: 1, padding: 16, marginBottom: 12 },
  button: { borderWidth: 1, borderColor: THEMES.night.border, borderRadius: 8, minHeight: 48, justifyContent: 'center', padding: 12, marginBottom: 8 },
  buttonLabel: { color: THEMES.night.highlightAction, fontSize: 15, lineHeight: 23, fontWeight: '700' },
});
