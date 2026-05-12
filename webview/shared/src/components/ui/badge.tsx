import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring oc-badge',
  {
    variants: {
      variant: {
        default:     'border-oc-border bg-primary text-primary-foreground hover:opacity-90',
        secondary:   'border-oc-border bg-secondary text-secondary-foreground hover:opacity-90',
        destructive: 'border-oc-red/45 bg-destructive text-destructive-foreground hover:opacity-90',
        outline:     'border-oc-border text-foreground',
        accent:      'border-oc-accent/35 bg-oc-accent-soft oc-tinted-badge-text',
        success:     'border-oc-green/45 bg-oc-green/10 text-oc-green',
        error:       'border-oc-red/45 bg-oc-red/10 text-oc-red',
        warning:     'border-oc-yellow/45 bg-oc-yellow/10 text-oc-yellow',
        muted:       'border-oc-border bg-oc-panel-soft oc-text-secondary',
        status:      'border-oc-border font-medium bg-oc-panel-soft',
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


