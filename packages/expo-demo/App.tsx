import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import CodeEditor, { CodeEditorSyntaxStyles } from '@rivascva/react-native-code-editor';
import { parse } from '@popkorn/player';
import { PopkornView } from '@popkorn/react-native';
import { TURKEY_SCENE } from './turkey';
import { examples } from './examples.gen';

const MONOSPACE = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// The gallery + the Lottie-converted turkey as the opening scene.
const GALLERY = [{ key: 'turkey', label: 'Turkey', source: TURKEY_SCENE }, ...examples];

// Background swatches (matches the playground's stage-background control). The
// scene paints its own canvas background if it declares one; these fill behind
// transparent scenes. ponytail: presets over a color-picker dependency.
const BACKGROUNDS = ['#aaf0d1', '#ffffff', '#000000', '#1e1e2e', '#f5f5dc', '#0a4d68', '#ff6b6b'];

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
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
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

  // Validate before swapping so a bad scene shows a message, not a crash.
  const applyScene = (css: string): boolean => {
    try {
      parse(css);
      setError(null);
      setSource(css);
      setDraft(css);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const onLoad = () => {
    if (applyScene(draft)) setEditorOpen(false);
  };

  const onCancel = () => {
    setDraft(source); // discard unsaved edits
    setError(null);
    setEditorOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.picker, { paddingTop: insets.top + 8 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
          {GALLERY.map((ex) => (
            <Pressable
              key={ex.key}
              style={({ pressed }) => [styles.chip, source === ex.source && styles.chipActive, pressed && styles.fabPressed]}
              onPress={() => applyScene(ex.source)}
            >
              <Text style={[styles.chipText, source === ex.source && styles.chipTextActive]}>{ex.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.swatchRow}>
          {BACKGROUNDS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setBackground(c)}
              style={[styles.swatch, { backgroundColor: c }, background === c && styles.swatchActive]}
            />
          ))}
        </View>
      </View>

      <View style={[styles.stage, { backgroundColor: background }]}>
        {/* Freeze the timeline while a sheet is open: the Skia PoC records a
            picture on the JS thread every frame, which otherwise fights the
            editor's per-keystroke re-highlight (and the sheet slide) for the one
            JS thread. `paused` keeps the loop mounted, just stops ticking. */}
        <PopkornView source={source} width={stage} height={stage} loop paused={editorOpen || urlOpen} />
      </View>

      <View style={[styles.buttonBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.fabPressed]}
          onPress={() => { setError(null); setUrlOpen(true); }}
        >
          <Text style={styles.buttonSecondaryText}>Load URL</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && styles.fabPressed]}
          onPress={openEditor}
        >
          <Text style={styles.buttonPrimaryText}>Edit CSS</Text>
        </Pressable>
      </View>

      <UrlModal
        visible={urlOpen}
        onClose={() => setUrlOpen(false)}
        onLoaded={(css) => { if (applyScene(css)) setUrlOpen(false); }}
        error={error}
        setError={setError}
      />

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

function UrlModal({
  visible,
  onClose,
  onLoaded,
  error,
  setError,
}: {
  visible: boolean;
  onClose: () => void;
  onLoaded: (css: string) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const fetchUrl = async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onLoaded(await res.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        setError('Camera permission denied');
        return;
      }
    }
    setScanning(true);
  };

  const onScanned = (data: string) => {
    setScanning(false);
    setUrl(data);
    fetchUrl(data); // QR encodes the URL; load it straight away
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Load .css from URL</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.cancel}>Close</Text>
            </Pressable>
          </View>

          {scanning ? (
            <View style={styles.scanner}>
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => onScanned(data)}
              />
              <Pressable style={styles.scanCancel} onPress={() => setScanning(false)}>
                <Text style={styles.fabText}>Cancel scan</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://…/scene.css"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.urlInput}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.urlActions}>
                <Pressable style={({ pressed }) => [styles.fabSecondary, pressed && styles.fabPressed]} onPress={openScanner}>
                  <Text style={styles.fabSecondaryText}>Scan QR</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.load, styles.loadFlex, (!url || loading) && styles.loadDisabled, pressed && styles.fabPressed]}
                  onPress={() => fetchUrl(url)}
                  disabled={!url || loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loadText}>Load</Text>}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  picker: { paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e0e0e0' },
  pickerRow: { paddingHorizontal: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f0f0f0' },
  chipActive: { backgroundColor: '#111' },
  chipText: { fontSize: 13, color: '#333', fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  swatchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 10, justifyContent: 'center' },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#ccc' },
  swatchActive: { borderWidth: 3, borderColor: '#3b82f6' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  buttonBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 28,
    alignItems: 'center',
  },
  buttonPrimary: { backgroundColor: '#111' },
  buttonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  buttonSecondaryText: { color: '#111', fontWeight: '700', fontSize: 15 },
  fabPressed: { opacity: 0.8 },
  fabText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  fabSecondary: {
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  fabSecondaryText: { color: '#111', fontWeight: '600', fontSize: 14 },
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
  urlInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
  },
  urlActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  scanner: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  scanCancel: { position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  error: { color: '#d00', fontSize: 12 },
  load: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadFlex: { flex: 1 },
  loadDisabled: { backgroundColor: '#ccc' },
  loadText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
