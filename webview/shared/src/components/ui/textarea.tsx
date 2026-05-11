import * as React from 'react';

import { cn } from '@/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[44px] w-full rounded-md border-0 bg-transparent px-2 py-1 text-[13px] placeholder:text-oc-text-soft focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 oc-textarea',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };

