import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** A drop target with a Browse button. Keyboard users get the button; everyone can drag files in. */
export function Dropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  hint,
  disabled = false,
  children,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`dropzone${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      {children ?? (
        <>
          <span className="dropzone-icon" aria-hidden="true">
            <Icon name="upload" size={22} />
          </span>
          <strong className="dropzone-title">{over ? 'Drop to upload' : title}</strong>
          <span className="dropzone-hint">{hint}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={disabled}>
            Browse files
          </button>
        </>
      )}
    </div>
  );
}

/** Opens the same file picker from elsewhere, e.g. a Replace button. */
export function FilePickerButton({
  accept,
  multiple = false,
  onFiles,
  children,
  className = 'btn btn-ghost btn-sm',
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  );
}
