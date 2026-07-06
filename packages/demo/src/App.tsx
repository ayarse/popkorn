import { useState, useEffect, useRef } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-css';
import 'prismjs/themes/prism-tomorrow.css';
import { MotionCanvas } from './components/MotionCanvas';
import { convertLottie } from '../../../tools/lottie2popcorn';
import { examples } from './examples';

function App() {
  const [currentExample, setCurrentExample] = useState<string | null>('motion');
  const [source, setSource] = useState(examples[1].source);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ex = examples.find((e) => e.key === currentExample);
    if (ex) setSource(ex.source);
  }, [currentExample]);

  // Returns true on success so callers can close the modal.
  function importLottie(text: string, label: string): boolean {
    setError(null);
    setImportStatus(null);
    let lottie: any;
    try {
      lottie = JSON.parse(text);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
      return false;
    }
    try {
      const { css, warnings, blocked } = convertLottie(lottie);
      setCurrentExample(null);
      setSource(css);
      const parts: string[] = [];
      if (warnings.length) parts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`);
      if (blocked.length) parts.push(`blocked: ${blocked.join('; ')}`);
      setImportStatus(parts.length ? `Imported ${label} — ${parts.join(' | ')}` : `Imported ${label}`);
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  function handleLottieFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { if (importLottie(reader.result as string, `"${file.name}"`)) setShowImport(false); };
    reader.onerror = () => setError(`Could not read file: ${file.name}`);
    reader.readAsText(file);
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0a0a1a',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        padding: '12px 20px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        flexShrink: 0,
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#4ecdc4' }}>
          Popcorn
        </h1>
        <span style={{ color: '#666', fontSize: '13px' }}>
          CSS-like DSL for interactive motion graphics
        </span>

        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          {examples.map((ex) => (
            <button
              key={ex.key}
              onClick={() => { setCurrentExample(ex.key); setImportStatus(null); setError(null); }}
              style={{
                padding: '6px 14px',
                backgroundColor: currentExample === ex.key ? '#4ecdc4' : '#252530',
                color: currentExample === ex.key ? '#000' : '#888',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: currentExample === ex.key ? 600 : 400,
              }}
            >
              {ex.label}
            </button>
          ))}
          <button
            onClick={() => setShowImport(true)}
            style={{
              padding: '6px 14px',
              backgroundColor: '#252530',
              color: '#888',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 400,
            }}
          >
            Import Lottie
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLottieFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <div style={{
            backgroundColor: '#ff4444',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            maxWidth: '400px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {error}
          </div>
        )}

        {!error && importStatus && (
          <div style={{
            backgroundColor: '#4ecdc4',
            color: '#000',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            maxWidth: '400px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {importStatus}
          </div>
        )}
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Source panel */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          borderRight: '1px solid #333',
          backgroundColor: '#0f0f1a',
        }}>
          <Editor
            value={source}
            onValueChange={setSource}
            highlight={(code) => Prism.highlight(code, Prism.languages.css, 'css')}
            padding={16}
            style={{
              minHeight: '100%',
              fontSize: '13px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: '1.6',
              backgroundColor: 'transparent',
            }}
          />
        </div>

        {/* Animation panel */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a12',
          padding: '20px',
          overflow: 'hidden',
        }}>
          {/* Bounded container: the player fills it and letterboxes (fit=contain),
              so oversized scenes shrink to fit instead of clipping. */}
          <div style={{
            width: '100%',
            height: '100%',
            maxWidth: '960px',
            display: 'flex',
          }}>
            <MotionCanvas
              source={source}
              style={{ height: '100%' }}
              onError={(err) => setError(err.message)}
              onSceneReady={() => setError(null)}
            />
          </div>
        </div>
      </div>

      {showImport && (
        <ImportModal
          onFile={handleLottieFile}
          onText={(text) => { if (importLottie(text, 'pasted JSON')) setShowImport(false); }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

function ImportModal({ onFile, onText, onClose }: {
  onFile: (file: File) => void;
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '480px', maxWidth: '90vw',
          backgroundColor: '#14141f',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#4ecdc4' }}>Import Lottie</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888', fontSize: '20px',
            cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Dropzone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          style={{
            border: `2px dashed ${dragOver ? '#4ecdc4' : '#3a3a4a'}`,
            borderRadius: '6px',
            padding: '32px 16px',
            textAlign: 'center',
            color: dragOver ? '#4ecdc4' : '#888',
            backgroundColor: dragOver ? 'rgba(78,205,196,0.08)' : 'transparent',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Drop a <code>.json</code> file here, or click to browse
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#555', fontSize: '12px' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
          or paste JSON
          <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "v": "5.7.0", "layers": [ ... ] }'
          spellCheck={false}
          style={{
            width: '100%', height: '140px', resize: 'vertical',
            backgroundColor: '#0f0f1a', color: '#ddd',
            border: '1px solid #333', borderRadius: '6px',
            padding: '10px', boxSizing: 'border-box',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '12px', lineHeight: 1.5,
          }}
        />

        <button
          onClick={() => onText(text)}
          style={{
            alignSelf: 'flex-end',
            padding: '8px 18px',
            backgroundColor: '#4ecdc4',
            color: '#000',
            border: 'none', borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px', fontWeight: 600,
          }}
        >
          Import JSON
        </button>
      </div>
    </div>
  );
}

export default App;
