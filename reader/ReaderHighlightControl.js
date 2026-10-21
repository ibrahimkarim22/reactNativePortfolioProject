import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { THEMES } from './readerConstants';
import { createHighlightAction } from './readerHighlightAction';

export default function ReaderHighlightControl({ mode = 'list', count = 0, disabled = false,
  theme = THEMES.paper, capture, getScope, onPicker, onList, onError, triggerRef }) {
  const { fontScale = 1, width: viewportWidth } = useWindowDimensions();
  const latest = useRef(null);
  const lifecycle = useRef({ mounted: true });
  latest.current = { mode, disabled, capture, getScope, onPicker, onList, onError };
  const gesture = useRef(null);
  const keyboard = useRef(null);
  const controller = useRef(null);
  if (!controller.current) controller.current = createHighlightAction({
    capture: () => latest.current.capture(),
    getScope: () => !lifecycle.current.mounted || latest.current.disabled ? null : latest.current.getScope(),
    onPicker: (...args) => latest.current.onPicker?.(...args),
    onList: (...args) => latest.current.onList?.(...args),
    onError: (...args) => latest.current.onError?.(...args),
  });
  const action = controller.current;
  const cancel = () => {
    gesture.current = null;
    keyboard.current = null;
    action.invalidate();
  };
  // A disabled transition invalidates immediately, before pending microtasks.
  if (disabled) cancel();
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => {
      lifecycle.current.mounted = false;
      cancel();
    };
  }, [action]);

  const startTouch = event => {
    if (latest.current.disabled || keyboard.current) return;
    // RN Web calls keyboard onPressIn before the supplied onKeyDown. The
    // explicit keyboard path below owns that activation and its one capture.
    if (Platform.OS === 'web' && (event?.key || event?.nativeEvent?.key)) return;
    const originalMode = latest.current.mode;
    gesture.current = { mode: originalMode, token: action.begin(originalMode) };
  };
  const finishTouch = () => {
    const pressed = gesture.current;
    gesture.current = null;
    if (!latest.current.disabled && pressed?.token) action.activate(pressed.mode, pressed.token);
    // A bare onPress is not sufficient intent after a cancelled touch. Native
    // accessibility and web keyboard use their explicit activation paths below.
  };
  const pressOut = () => {
    const pressed = gesture.current;
    // Pressability normally calls onPressOut and onPress in the same transition.
    // If there is no completed onPress, retire the preparation after that turn.
    const retire = () => {
      if (pressed && gesture.current === pressed) {
        gesture.current = null;
        action.cancel(pressed.token);
      }
    };
    // RN Web uses the browser's later click dispatch for onPress. Keep only
    // that release turn alive; native Pressability completes synchronously.
    if (Platform.OS === 'web') setTimeout(retire, 0);
    else Promise.resolve().then(retire);
  };
  const accessibilityAction = event => {
    if (latest.current.disabled || event.nativeEvent?.actionName !== 'activate') return;
    gesture.current = null;
    keyboard.current = null;
    action.accessibilityActivate(latest.current.mode);
  };
  const keyDown = event => {
    const key = event.nativeEvent?.key ?? event.key;
    if (latest.current.disabled || (key !== 'Enter' && key !== ' ')) return;
    event.preventDefault?.();
    if (keyboard.current || event.nativeEvent?.repeat || event.repeat) return;
    gesture.current = null;
    const originalMode = latest.current.mode;
    keyboard.current = { key, mode: originalMode, token: action.begin(originalMode) };
  };
  const keyUp = event => {
    const key = event.nativeEvent?.key ?? event.key;
    if (latest.current.disabled || (key !== 'Enter' && key !== ' ')) return;
    event.preventDefault?.();
    const pressed = keyboard.current;
    keyboard.current = null;
    if (pressed?.key === key && pressed.token) action.activate(pressed.mode, pressed.token);
  };

  // Reserve the longest supported label at every state. Font-scale changes may
  // change this allocation; a live selection, count or loading label cannot.
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const availableWidth = Number.isFinite(viewportWidth) ? Math.max(48, viewportWidth - 40) : 320;
  const width = Math.max(48, Math.floor(Math.min(152 * scale, availableWidth * 0.48)));
  // Narrow viewports may wrap the word Highlights as well as its count. Reserve
  // that third line for every mode so wrapping never resizes the document.
  const lines = width < 110 * scale ? 3 : 2;
  const height = Math.max(48, Math.ceil(20 * scale * lines + 16));
  const label = disabled ? 'Highlights loading' : mode === 'highlight' ? 'Highlight' : `Highlights (${count})`;
  return (
    <Pressable
      ref={triggerRef}
      key="reader-highlight-control"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled }}
      accessibilityActions={[{ name: 'activate', label: mode === 'highlight' ? 'Highlight' : 'Open highlights' }]}
      onAccessibilityAction={accessibilityAction}
      disabled={disabled}
      onPressIn={startTouch}
      onPressOut={pressOut}
      onPress={finishTouch}
      onTouchCancel={cancel}
      onBlur={cancel}
      {...(Platform.OS === 'web' ? { onKeyDown: keyDown, onKeyUp: keyUp } : {})}
      style={[styles.control, { width, height, minHeight: height }]}
    >
      <Text style={[styles.label, { color: disabled ? theme.secondary : theme.accent }]}>
        {disabled ? 'Loading…' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: 48, flexShrink: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  label: { fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif', fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
});
