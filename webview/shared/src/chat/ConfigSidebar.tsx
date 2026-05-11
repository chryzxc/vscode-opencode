import { useState } from 'react';
import { File, Save } from 'lucide-react';
import type { ConfigFile } from './lib/types';
import { Button } from '@/components/ui/button';

interface ConfigSidebarProps {
  files: ConfigFile[];
  activeFileName: string | null;
  onSelectFile: (fileName: string) => void;
  onSaveFile: (fileName: string) => void;
}

export function ConfigSidebar({ files, activeFileName, onSelectFile, onSaveFile }: ConfigSidebarProps) {
  return (
    <div className="w-60 border-r border-oc-border bg-oc-bg overflow-y-auto">
      <div className="p-3 border-b border-oc-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider oc-text-secondary">
          Configuration Files
        </h3>
      </div>
      <div className="py-2">
        {files.map((file) => (
          <ConfigFileItem
            key={file.name}
            file={file}
            isActive={file.name === activeFileName}
            onSelect={() => onSelectFile(file.name)}
            onSave={() => onSaveFile(file.name)}
          />
        ))}
      </div>
    </div>
  );
}

interface ConfigFileItemProps {
  file: ConfigFile;
  isActive: boolean;
  onSelect: () => void;
  onSave: () => void;
}

function ConfigFileItem({ file, isActive, onSelect, onSave }: ConfigFileItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`mx-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-oc-accent/20 oc-tinted-badge-text'
          : 'hover:bg-oc-bg-soft text-oc-text'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <File className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="text-xs truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {(isHovered || isActive) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              aria-label={`Save ${file.name}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onSave();
              }}
            >
              <Save className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

