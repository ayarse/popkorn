import { useState } from "react";
import Editor from "react-simple-code-editor";
import { ScenePreview } from "@/components/scene-preview";
import { highlight } from "@/lib/docs-render";

const highlightCss = (code: string) => highlight(code, "css");

/** A docs scene: the running scene above its source, editable in place. */
export function DocsSceneBlock({ source }: { source: string }) {
  const [code, setCode] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const edited = code !== source;

  function update(next: string) {
    setError(null);
    setCode(next);
  }

  return (
    <figure className="scene-block">
      <div className="scene-block-preview">
        <div className="mx-auto w-full max-w-[320px]">
          <ScenePreview source={code} onError={(e) => setError(e.message)} />
        </div>
      </div>
      <div className="code-block">
        <div className="code-head">
          <span>{edited ? "css · edited" : "css · editable"}</span>
          <span className="flex items-center gap-1">
            {edited && (
              <button
                type="button"
                className="code-copy"
                onClick={() => update(source)}
              >
                Reset
              </button>
            )}
            <button type="button" className="code-copy" data-copy>
              Copy
            </button>
          </span>
        </div>
        <Editor
          value={code}
          onValueChange={update}
          highlight={highlightCss}
          padding={16}
          tabSize={2}
          className="scene-editor"
          textareaClassName="scene-editor-input"
          aria-label="Scene source"
        />
        {error && <p className="scene-error">{error}</p>}
      </div>
    </figure>
  );
}
