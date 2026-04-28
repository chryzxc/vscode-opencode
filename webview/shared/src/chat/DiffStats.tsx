/**
 * DiffStats - Reusable component for displaying file change statistics
 * 
 * Renders added/deleted counts with proper theme-aware coloring.
 * Used by both FileChangesSection and DiffReviewShell for consistent styling.
 */

import { Plus, Minus } from 'lucide-react';

interface DiffStatsProps {
  added: number;
  deleted: number;
  className?: string;
  showIcons?: boolean;
  iconSize?: 'sm' | 'md';
}

export function DiffStats({ 
  added, 
  deleted, 
  className = '', 
  showIcons = false,
  iconSize = 'md'
}: DiffStatsProps) {
  if (added === 0 && deleted === 0) {
    return null;
  }

  const iconSizeClass = iconSize === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <div className={`flex items-center gap-1 font-mono text-xs ${className}`}>
      {added > 0 && (
        <span 
          className={showIcons ? 'flex items-center gap-0.5' : ''}
          style={{ color: 'var(--oc-green)' }}
        >
          {showIcons && <Plus className={iconSizeClass} />}
          {showIcons ? added : `+${added}`}
        </span>
      )}
      {deleted > 0 && (
        <span 
          className={showIcons ? 'flex items-center gap-0.5' : ''}
          style={{ color: 'var(--oc-red)' }}
        >
          {showIcons && <Minus className={iconSizeClass} />}
          {showIcons ? deleted : `-${deleted}`}
        </span>
      )}
    </div>
  );
}
