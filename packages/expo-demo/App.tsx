import { useState } from 'react';
import {
  Button,
  Dimensions,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parse } from '@popcorn/player';
import { PopcornView } from '@popcorn/skia';
import { TURKEY_SCENE } from './turkey';

const STAGE = Math.min(Dimensions.get('window').width - 24, 360);

export default function App() {
  const [source, setSource] = useState(TURKEY_SCENE);
  const [draft, setDraft] = useState(TURKEY_SCENE);
  const [error, setError] = useState<string | null>(null);

  const onLoad = () => {
    try {
      parse(draft); // validate before remounting so a bad scene shows a message, not a crash
      setError(null);
      setSource(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.stage}>
        <PopcornView source={source} width={STAGE} height={STAGE} loop />
      </View>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Paste Popcorn CSS…"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Load" onPress={onLoad} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12, backgroundColor: '#fff', gap: 8 },
  stage: { alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    fontFamily: 'Courier',
    fontSize: 12,
    textAlignVertical: 'top',
  },
  error: { color: '#d00', fontSize: 12 },
});
