import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-oc-2xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring oc-badge',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary text-primary-foreground hover:opacity-90',
        secondary:   'border-transparent bg-secondary text-secondary-foreground hover:opacity-90',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:opacity-90',
        outline:     'text-foreground',
        accent:      'border-oc-border bg-oc-accent-soft text-oc-accent',
        success:     'border-oc-border text-oc-green',
        error:       'border-oc-border text-oc-red',
        warning:     'border-oc-yellow/30 bg-oc-yellow/10 text-oc-yellow',
        muted:       'border-oc-border text-oc-text-muted',
        status:      'border-oc-border font-mono uppercase tracking-wider',
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
