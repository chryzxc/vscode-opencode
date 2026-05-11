import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring oc-badge',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary text-primary-foreground hover:opacity-90',
        secondary:   'border-transparent bg-secondary text-secondary-foreground hover:opacity-90',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:opacity-90',
        outline:     'text-foreground',
        accent:      'border-transparent bg-oc-accent-soft oc-tinted-badge-text',
        success:     'border-transparent bg-oc-green/10 text-oc-green',
        error:       'border-transparent bg-oc-red/10 text-oc-red',
        warning:     'border-transparent bg-oc-yellow/10 text-oc-yellow',
        muted:       'border-transparent bg-oc-panel-soft oc-text-secondary',
        status:      'border-transparent font-medium bg-oc-panel-soft',
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };


