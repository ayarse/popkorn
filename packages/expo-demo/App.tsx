import { useEffect, useState } from 'react';
import {
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import CodeEditor, { CodeEditorSyntaxStyles } from '@rivascva/react-native-code-editor';
import { parse } from '@popkorn/player';
import { PopkornView } from '@popkorn/react-native';
import { TURKEY_SCENE } from './turkey';

const MONOSPACE = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// @rivascva/react-native-code-editor drives react-syntax-highlighter, which
// re-parses the WHOLE source synchronously on the JS thread on every render and
// is effectively unusable past ~200 lines. Above this cap we drop to a plain
// TextInput — still fully editable, just without highlighting (the turkey scene
// alone is 2300+ lines, where highlighting is hopeless).
const HIGHLIGHT_LINE_CAP = 300;

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const stage = Math.min(width - insets.left - insets.right - 24, height - insets.top - insets.bottom - 24, 600);
  const editorHeight = Math.min(Math.max(height * 0.42, 220), 420);

  const [source, setSource] = useState(TURKEY_SCENE);
  const [draft, setDraft] = useState(TURKEY_SCENE);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // The editor is heavy to mount, so we let the modal slide in first (showing a
  // placeholder) and only mount it after interactions settle — the open feels
  // instant instead of freezing on the synchronous highlight parse.
  const [editorReady, setEditorReady] = useState(false);
  const dirty = draft !== source;
  const useHighlighter = draft.split('\n').length <= HIGHLIGHT_LINE_CAP;

  useEffect(() => {
    if (!editorOpen) {
      setEditorReady(false);
      return;
    }
    const handle = InteractionManager.runAfterInteractions(() => setEditorReady(true));
    return () => handle.cancel();
  }, [editorOpen]);

  const openEditor = () => setEditorOpen(true);

  const onLoad = () => {
    try {
      parse(draft); // validate before remounting so a bad scene shows a message, not a crash
      setError(null);
      setSource(draft);
      setEditorOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onCancel = () => {
    setDraft(source); // discard unsaved edits
    setError(null);
    setEditorOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {/* Keep playing behind the editor sheet — the per-frame render is cheap
            (cached paths/shaders/dashes), and the deferred editor mount above
            protects the open transition. */}
        <PopkornView source={source} width={stage} height={stage} loop />
      </View>

      <Pressable
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 16 }, pressed && styles.fabPressed]}
        onPress={openEditor}
      >
        <Text style={styles.fabText}>Edit CSS</Text>
      </Pressable>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={onCancel}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.backdrop} onPress={onCancel} />
          <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Edit Popkorn CSS</Text>
              <Pressable onPress={onCancel} hitSlop={8}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
            <View style={[styles.editorFrame, { height: editorHeight }]}>
              {!editorReady ? (
                <View style={styles.editorPlaceholder}>
                  <Text style={styles.placeholderText}>Loading editor…</Text>
                </View>
              ) : useHighlighter ? (
                <CodeEditor
                  language="css"
                  syntaxStyle={CodeEditorSyntaxStyles.atomOneLight}
                  initialValue={draft}
                  onChange={setDraft}
                  showLineNumbers
                  autoFocus={false}
                  style={{
                    fontSize: 12,
                    fontFamily: MONOSPACE,
                    inputLineHeight: 18,
                    highlighterLineHeight: 18,
                    padding: 10,
                    height: editorHeight,
                  }}
                />
              ) : (
                <TextInput
                  defaultValue={draft}
                  onChangeText={setDraft}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textAlignVertical="top"
                  style={[styles.plainEditor, { height: editorHeight }]}
                />
              )}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.load, !dirty && styles.loadDisabled, pressed && dirty && styles.fabPressed]}
              onPress={onLoad}
              disabled={!dirty}
            >
              <Text style={styles.loadText}>Load</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#111',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabPressed: { opacity: 0.8 },
  fabText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '75%',
    gap: 8,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { fontSize: 16, fontWeight: '600' },
  cancel: { color: '#666', fontSize: 14 },
  editorFrame: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    overflow: 'hidden',
  },
  editorPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa' },
  placeholderText: { color: '#999', fontSize: 13 },
  plainEditor: { fontFamily: MONOSPACE, fontSize: 12, lineHeight: 18, padding: 10, color: '#111', backgroundColor: '#fff' },
  error: { color: '#d00', fontSize: 12 },
  load: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadDisabled: { backgroundColor: '#ccc' },
  loadText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
